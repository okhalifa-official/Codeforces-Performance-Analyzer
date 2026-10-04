"""Load the merged CSVs into Postgres.

Runs after scripts/merge_and_retrain.py. The CSV stays the intermediate
artifact (and the release asset), so the merge logic and its regression tests
are untouched — this only adds a publish step.

Loading goes into a staging table and then swaps it in inside one transaction.
A partially-loaded 14M-row table must never be visible to the website, and the
old table survives until the swap commits, so a failed load changes nothing.

Usage:
  DATABASE_URL=... python scripts/db/load.py
  DATABASE_URL=... python scripts/db/load.py --table submissions

Env:
  DATA_DIR  - project root (default: repo root)
"""

import os
import sys
import csv
import time
import logging
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.db.connection import raw_connection  # noqa: E402

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", str(Path(__file__).resolve().parents[2]))
DATASET_DIR = os.path.join(DATA_DIR, "ML", "dataset")

# Staging-and-swap needs ~2x the table size on disk while both copies exist.
# Railway's default Postgres volume is 5 GB, which a 14M-row submissions table
# plus its index overruns. LOW_DISK=1 truncates and loads in place instead:
# one copy on disk, still inside a transaction, but the table is empty for the
# duration of the load.
LOW_DISK = os.environ.get("LOW_DISK", "0") == "1"

# Written by scripts/merge_and_retrain.py: only the rows this run added.
DELTA_CSV_NAME = "04_new_submissions_delta.csv"

# table -> (csv file, columns to load). Columns are resolved against the CSV
# header at run time so a schema-drifted file loads what it has and defaults
# the rest, rather than failing the whole load.
TABLES = {
    "submissions": "04_filtered_submissions.csv",
    "user_tag_strengths": "06_user_tag_strengths.csv",
    "user_profiles": "02_user_profiles.csv",
}


def _set_session_limits(conn):
    """Make a stuck statement fail loudly instead of hanging the workflow.

    The first incremental run sat in one query for the full 3 h job timeout
    and was cancelled with no error. A statement_timeout turns that into a
    real exception (and a rollback) in minutes. Tunable through env for the
    rare legitimately slow statement.
    """
    stmt = os.environ.get("DB_STATEMENT_TIMEOUT", "20min")
    lock = os.environ.get("DB_LOCK_TIMEOUT", "2min")
    work_mem = os.environ.get("DB_WORK_MEM", "512MB")
    with conn.cursor() as cur:
        cur.execute("SELECT set_config('statement_timeout', %s, false), "
                    "set_config('lock_timeout', %s, false), "
                    "set_config('work_mem', %s, false)", (stmt, lock, work_mem))
    conn.commit()
    log.info("session limits: statement_timeout=%s lock_timeout=%s work_mem=%s",
             stmt, lock, work_mem)


def _migrate_column_types(cur, table):
    """Widen columns whose type no longer matches what the CSVs contain.

    submitted_at was originally bigint, but the merge writes it via pandas,
    which renders a NaN-carrying integer column as float ("1783834810.0").
    A database created before this fix still has bigint, so widen it in place
    rather than requiring a manual migration.
    """
    if table != "submissions":
        return
    cur.execute("""
        SELECT data_type FROM information_schema.columns
        WHERE table_name = %s AND column_name = 'submitted_at'
    """, (table,))
    row = cur.fetchone()
    if row and row[0] == "bigint":
        log.info("%s: widening submitted_at bigint -> double precision", table)
        cur.execute(f"ALTER TABLE {table} "
                    f"ALTER COLUMN submitted_at TYPE DOUBLE PRECISION")


def _apply_schema(cur):
    """Run scripts/db/schema.sql. Idempotent — safe on every load."""
    path = Path(__file__).with_name("schema.sql")
    if not path.is_file():
        raise RuntimeError(f"schema.sql not found at {path}")
    cur.execute(path.read_text())


def _copy_into(cur, path, cols, copy_sql, header):
    """Stream a CSV into whatever table copy_sql targets."""
    if len(cols) == len(header):
        # Same columns in the same order: stream the file straight through.
        with open(path, "rb") as f, cur.copy(copy_sql) as cp:
            while chunk := f.read(1 << 20):
                cp.write(chunk)
        return

    # The CSV carries columns this table does not want (e.g.
    # 02_user_profiles.csv has 51 columns, user_profiles keeps 3). Project to
    # the wanted columns while streaming, so the file is never held in memory.
    idx = [header.index(c) for c in cols]
    with open(path, newline="") as f, cur.copy(copy_sql) as cp:
        reader = csv.reader(f)
        next(reader, None)          # drop the source header
        # COPY was told HEADER true, so feed it one header line that matches
        # the projected column list.
        cp.write(_csv_rows([cols]))
        buf = []
        for row in reader:
            if len(row) <= idx[-1]:
                continue            # short/ragged line
            buf.append([row[i] for i in idx])
            if len(buf) >= 50_000:
                cp.write(_csv_rows(buf))
                buf = []
        if buf:
            cp.write(_csv_rows(buf))


def _csv_rows(rows) -> str:
    """Serialize rows back to CSV text for COPY, quoting everything so empty
    fields stay distinguishable and embedded commas survive."""
    import io
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerows(rows)
    return out.getvalue()


def _table_columns(cur, table):
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s AND table_schema = 'public'
    """, (table,))
    return {r[0] for r in cur.fetchall()}


def _csv_header(path):
    with open(path, newline="") as f:
        return next(csv.reader(f))


def append_delta(conn, csv_name=DELTA_CSV_NAME):
    """Append only this run's new submissions, instead of reloading everything.

    A full reload needs ~2x the table size on disk while the old and new copies
    coexist, which a 1.9 GB table cannot do on Railway's default 5 GB volume.
    Appending needs headroom proportional to the delta (a few hundred MB), and
    takes seconds rather than minutes.

    Dedup happens in the database, not just in the CSV: the delta is deduped
    against the *previous dataset file*, but the table could already hold those
    rows (a re-run, a partial earlier load, or a delta applied twice). Rows are
    staged and then inserted with a NOT EXISTS guard, so applying the same
    delta repeatedly is a no-op.

    Returns (inserted, skipped) or None when there is no delta to apply.
    """
    path = os.path.join(DATASET_DIR, csv_name)
    if not os.path.exists(path):
        log.info("No delta file at %s — nothing to append", path)
        return None
    if os.path.getsize(path) == 0:
        log.info("Delta file is empty — nothing to append")
        return None

    table = "submissions"
    with conn.cursor() as cur:
        db_cols = _table_columns(cur, table)
        if not db_cols:
            log.info("%s missing — applying schema.sql", table)
            _apply_schema(cur)
            db_cols = _table_columns(cur, table)
        _migrate_column_types(cur, table)

        header = _csv_header(path)
        cols = [c for c in header if c in db_cols]
        if not cols:
            raise RuntimeError(f"delta has no columns in common with {table}")

        cur.execute(f"SELECT count(*) FROM {table}")
        before = cur.fetchone()[0]

        staging = f"{table}_delta"
        cur.execute(f"DROP TABLE IF EXISTS {staging}")
        # UNLOGGED: this table is transient, and skipping WAL for it keeps the
        # write amplification (and disk churn) down on a small volume.
        cur.execute(f"CREATE UNLOGGED TABLE {staging} "
                    f"(LIKE {table} INCLUDING DEFAULTS)")

        collist = ", ".join(f'"{c}"' for c in cols)
        numeric_cols = [c for c in cols
                        if c not in ("handle", "tag", "problem_id", "problem_name")]
        force_null = ""
        if numeric_cols:
            force_null = (", FORCE_NULL (" +
                          ", ".join(f'"{c}"' for c in numeric_cols) + ")")
        copy_sql = (f"COPY {staging} ({collist}) FROM STDIN "
                    f"WITH (FORMAT csv, HEADER true, NULL ''{force_null})")

        t0 = time.time()
        log.info("delta: COPY %s (%.1f MB) into %s …",
                 csv_name, os.path.getsize(path) / 1e6, staging)
        _copy_into(cur, path, cols, copy_sql, header)

        cur.execute(f"SELECT count(*) FROM {staging}")
        staged = cur.fetchone()[0]
        log.info("delta: %d rows staged in %.0fs", staged, time.time() - t0)

        if staged == 0:
            cur.execute(f"DROP TABLE {staging}")
            log.info("delta: nothing staged")
            return (0, 0)

        # Identity of a submission. submitted_at is what separates repeat
        # attempts at the same problem, so it belongs in the key. It is the
        # only nullable key column (the pre-2026 base rows have no timestamp),
        # so it is COALESCEd to a sentinel and compared with plain `=`.
        #
        # Do NOT write these as `a.x IS NOT DISTINCT FROM b.x`: that operator
        # is neither hashable nor mergeable, so the planner falls back to a
        # nested loop. Against a ~4M-row delta that is ~10^13 comparisons and
        # the load hung for the whole 3 h job timeout with no output.
        key_cols = [c for c in ("handle", "problem_id", "submitted_at") if c in cols]

        def key(alias, c):
            return f"COALESCE({alias}.{c}, -1)" if c == "submitted_at" else f"{alias}.{c}"

        on_clause = " AND ".join(f"{key('t', c)} = {key('s', c)}" for c in key_cols)
        partition = ", ".join(key("x", c) for c in key_cols)

        # Dedup within the delta itself first: the same submission can appear
        # in two chunks when a handle straddles a chunk boundary. A window
        # function sorts once (n log n) instead of self-joining.
        t1 = time.time()
        cur.execute(f"""
            DELETE FROM {staging}
            WHERE ctid IN (
                SELECT ctid FROM (
                    SELECT x.ctid AS ctid,
                           row_number() OVER (PARTITION BY {partition}
                                              ORDER BY x.ctid) AS rn
                    FROM {staging} x
                ) d WHERE d.rn > 1
            )
        """)
        log.info("delta: collapsed %d duplicate rows inside the delta in %.0fs",
                 cur.rowcount, time.time() - t1)

        # With plain-equality keys this plans as a hash anti-join: one pass
        # over each side. DB_WORK_MEM (see _set_session_limits) lets the hash
        # stay in memory instead of spilling to the small data volume.
        t2 = time.time()
        cur.execute(f"""
            INSERT INTO {table} ({collist})
            SELECT {', '.join(f's."{c}"' for c in cols)}
            FROM {staging} s
            WHERE NOT EXISTS (
                SELECT 1 FROM {table} t WHERE {on_clause}
            )
        """)
        inserted = cur.rowcount
        log.info("delta: inserted %d new rows in %.0fs", inserted, time.time() - t2)
        cur.execute(f"DROP TABLE {staging}")

        cur.execute(f"SELECT count(*) FROM {table}")
        after = cur.fetchone()[0]
        skipped = staged - inserted
        log.info("delta: inserted %d, skipped %d already present "
                 "(%d -> %d rows)", inserted, skipped, before, after)
        return (inserted, skipped)


def load_table(conn, table, csv_name):
    path = os.path.join(DATASET_DIR, csv_name)
    if not os.path.exists(path):
        log.warning("%s: %s not found — skipping", table, path)
        return False

    with conn.cursor() as cur:
        db_cols = _table_columns(cur, table)
        if not db_cols:
            # Bootstrap a fresh database rather than failing the weekly run.
            # schema.sql is idempotent (CREATE TABLE IF NOT EXISTS).
            log.info("%s missing — applying schema.sql", table)
            _apply_schema(cur)
            db_cols = _table_columns(cur, table)
        if not db_cols:
            raise RuntimeError(
                f"Table {table} does not exist and schema.sql did not create it.")

        header = _csv_header(path)
        # Intersection, in CSV order: tolerate a CSV that has extra columns
        # (older/newer crawler) or is missing optional ones.
        cols = [c for c in header if c in db_cols]
        missing = db_cols - set(cols)
        if not cols:
            raise RuntimeError(f"{table}: no overlapping columns with {csv_name}")
        if missing:
            log.info("%s: CSV has no %s — those keep their column defaults",
                     table, ", ".join(sorted(missing)))

        _migrate_column_types(cur, table)

        staging = f"{table}_staging"
        cur.execute(f"DROP TABLE IF EXISTS {staging}")
        # Reclaim last run's backup before allocating this run's staging table.
        # On a small volume (Railway's default is 5 GB) the old copy is the
        # difference between fitting and ENOSPC.
        cur.execute(f"DROP TABLE IF EXISTS {table}_old")
        # INCLUDING ALL carries defaults/NOT NULL but not indexes we build later.
        if not LOW_DISK:
            cur.execute(f"CREATE TABLE {staging} (LIKE {table} INCLUDING DEFAULTS "
                        f"INCLUDING CONSTRAINTS)")

        collist = ", ".join(f'"{c}"' for c in cols)
        t0 = time.time()
        log.info("%s: COPY from %s (%.0f MB) …",
                 table, csv_name, os.path.getsize(path) / 1e6)

        # strength.py writes with csv.QUOTE_ALL, so a NaN lands as a quoted
        # empty string. Postgres rejects "" for real/int columns, so declare it
        # as the NULL marker; FORCE_NULL applies that to quoted empties too.
        numeric_cols = [c for c in cols if c not in ("handle", "tag",
                                                     "problem_id", "problem_name")]
        force_null = ""
        if numeric_cols:
            force_null = (", FORCE_NULL (" +
                          ", ".join(f'"{c}"' for c in numeric_cols) + ")")
        target = table if LOW_DISK else staging
        copy_sql = (f"COPY {target} ({collist}) FROM STDIN "
                    f"WITH (FORMAT csv, HEADER true, NULL ''{force_null})")

        dropped_pk = False
        if LOW_DISK:
            log.info("%s: LOW_DISK=1 — truncating and loading in place "
                     "(no staging copy; needs ~half the disk)", table)
            cur.execute(f"TRUNCATE {table}")
            # The CSVs contain rows that violate the primary key (duplicate
            # and "#NAME?" handles) and are cleaned up *after* the copy. In
            # staging mode the constraint is added afterwards, but here it
            # already exists, so COPY would abort on the first duplicate.
            # Drop it for the load and rebuild it once the data is clean.
            if table in ("user_profiles", "user_tag_strengths"):
                # Look the constraint name up rather than assuming
                # "<table>_pkey": a table that arrived via the staging swap
                # still carries "<table>_staging_pkey".
                cur.execute("""
                    SELECT conname FROM pg_constraint
                    WHERE conrelid = %s::regclass AND contype = 'p'
                """, (table,))
                row = cur.fetchone()
                if row:
                    cur.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{row[0]}"')
                    dropped_pk = True
        _copy_into(cur, path, cols, copy_sql, header)

        cur.execute(f"SELECT count(*) FROM {target}")
        n = cur.fetchone()[0]
        log.info("%s: %d rows copied in %.0fs", table, n, time.time() - t0)

        if n == 0:
            raise RuntimeError(f"{table}: loaded 0 rows — refusing to publish")

        # The released CSVs carry Excel-corrupted handles ("#NAME?") that
        # strength.py drops at read time; they collide on the primary key here.
        # Remove them, then collapse any remaining duplicate keys.
        if table in ("user_profiles", "user_tag_strengths"):
            cur.execute(f"DELETE FROM {target} WHERE handle = '#NAME?' "
                        f"OR handle IS NULL OR btrim(handle) = ''")
            removed = cur.rowcount
            if removed:
                log.info("%s: dropped %d corrupted handle rows", table, removed)

        if table == "user_profiles":
            cur.execute(f"""
                DELETE FROM {target} a USING {target} b
                WHERE a.ctid < b.ctid AND a.handle = b.handle
            """)
            if cur.rowcount:
                log.info("%s: collapsed %d duplicate handles", table, cur.rowcount)
        elif table == "user_tag_strengths":
            cur.execute(f"""
                DELETE FROM {target} a USING {target} b
                WHERE a.ctid < b.ctid AND a.handle = b.handle AND a.tag = b.tag
            """)
            if cur.rowcount:
                log.info("%s: collapsed %d duplicate (handle, tag) rows",
                         table, cur.rowcount)

        if LOW_DISK:
            if dropped_pk:
                key = "(handle, tag)" if table == "user_tag_strengths" else "(handle)"
                cur.execute(f"ALTER TABLE {table} ADD PRIMARY KEY {key}")
                log.info("%s: primary key rebuilt", table)
            # submissions keeps its own handle index through TRUNCATE, so
            # there is nothing else to rebuild or swap.
            log.info("%s: loaded in place (%d rows)", table, n)
            return True

        # Rebuild whatever the real table has on it.
        if table == "submissions":
            log.info("%s: building handle index …", table)
            cur.execute(f"CREATE INDEX {staging}_handle_idx ON {staging} (handle)")
        elif table == "user_tag_strengths":
            cur.execute(f"ALTER TABLE {staging} ADD PRIMARY KEY (handle, tag)")
        elif table == "user_profiles":
            cur.execute(f"ALTER TABLE {staging} ADD PRIMARY KEY (handle)")

        cur.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
        # Free the canonical index name before the staging index claims it:
        # the old table still owns it until it is renamed or dropped.
        if table == "submissions":
            cur.execute(f"ALTER INDEX IF EXISTS {table}_handle_idx "
                        f"RENAME TO {table}_old_handle_idx")
        cur.execute(f"ALTER TABLE {staging} RENAME TO {table}")
        if table == "submissions":
            cur.execute(f"ALTER INDEX IF EXISTS {staging}_handle_idx "
                        f"RENAME TO {table}_handle_idx")
        log.info("%s: swapped in (previous kept as %s_old)", table, table)

    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", choices=sorted(TABLES), help="load just this table")
    ap.add_argument("--keep-old", action="store_true",
                    help="keep the *_old tables instead of dropping them")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--incremental", action="store_true",
                      help="append only the new-submissions delta (default "
                           "when the delta file exists)")
    mode.add_argument("--full", action="store_true",
                      help="force a full reload of every table")
    args = ap.parse_args()

    delta_path = os.path.join(DATASET_DIR, DELTA_CSV_NAME)
    incremental = args.incremental or (not args.full
                                       and not args.table
                                       and os.path.exists(delta_path))

    conn = raw_connection()
    _set_session_limits(conn)

    if incremental:
        # Submissions grows by ~2.3M rows a week and is the only table big
        # enough to matter; the other two are small enough to replace whole.
        try:
            result = append_delta(conn)
            if result is None and args.incremental:
                raise RuntimeError(
                    f"--incremental requested but no delta at {delta_path}")
            for table in ("user_tag_strengths", "user_profiles"):
                load_table(conn, table, TABLES[table])
            conn.commit()
            log.info("Incremental update committed")
            with conn.cursor() as cur:
                for table in ("user_tag_strengths", "user_profiles"):
                    cur.execute(f"DROP TABLE IF EXISTS {table}_old")
                cur.execute("ANALYZE submissions")
            conn.commit()
            log.info("ANALYZE done")
            return
        except Exception:
            conn.rollback()
            log.error("Incremental update failed — rolled back, "
                      "existing tables untouched")
            raise
        finally:
            conn.close()

    targets = {args.table: TABLES[args.table]} if args.table else TABLES

    try:
        loaded = []
        for table, csv_name in targets.items():
            if load_table(conn, table, csv_name):
                loaded.append(table)
        # One transaction for every table: either the whole dataset flips or
        # none of it does, so the site never mixes old and new tables.
        conn.commit()
        log.info("Committed: %s", ", ".join(loaded) or "(nothing)")

        if not args.keep_old:
            with conn.cursor() as cur:
                for table in loaded:
                    cur.execute(f"DROP TABLE IF EXISTS {table}_old")
            conn.commit()
            log.info("Dropped previous *_old tables")

        with conn.cursor() as cur:
            cur.execute("ANALYZE")
        conn.commit()
        log.info("ANALYZE done")
    except Exception:
        conn.rollback()
        log.error("Load failed — rolled back, existing tables untouched")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
