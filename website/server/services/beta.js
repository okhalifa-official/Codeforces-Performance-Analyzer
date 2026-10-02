// Closed beta: Free tier only, no Plus / AI Coach, and only the first
// BETA_MAX_ACCOUNTS accounts may actually use the product. Later sign-ups still
// get an account (so they can be emailed at release) but are "waitlisted":
// the server refuses every feature route for them.
//
// The decisions are pure functions so they can be tested without Postgres or
// Express. Config is read from the environment at call time, so a redeploy with
// BETA_MODE=off restores the pre-beta behaviour with no other change.

const OFF_VALUES = new Set(["false", "0", "off"]);
const DEFAULT_MAX_ACCOUNTS = 100;

/** Beta is ON unless the variable is exactly "false", "0" or "off". */
export function betaMode(env = process.env) {
  const v = String(env.BETA_MODE ?? "").trim().toLowerCase();
  return !OFF_VALUES.has(v);
}

export function betaMaxAccounts(env = process.env) {
  const n = Number.parseInt(String(env.BETA_MAX_ACCOUNTS ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_ACCOUNTS;
}

/** The public contract behind GET /api/beta-config. */
export function betaConfig(env = process.env) {
  return { beta: betaMode(env), maxAccounts: betaMaxAccounts(env) };
}

/**
 * Should a new account be waitlisted? `nonAdminCount` is how many non-admin
 * accounts exist BEFORE this one, so with a cap of 100 the 100th account
 * (count 99) gets in and the 101st (count 100) does not. Admins never count
 * and are never waitlisted.
 */
export function shouldWaitlist({ beta, nonAdminCount, max, role = "user" }) {
  if (!beta || role === "admin") return false;
  return nonAdminCount >= max;
}

// Held for the length of the signup transaction (and the one-off backfill) so
// "count the accounts, then insert" is one atomic step. Without it two
// confirms for the last slot would both read 99 and both get in.
export const BETA_LOCK_KEY = 7_302_026;

/**
 * Insert a confirmed signup, deciding admin / waitlisted in the same
 * transaction. The advisory lock serialises concurrent confirms: the second
 * one waits at the lock, then counts the first one's committed row. The first
 * account ever created becomes the admin (as before) and is never waitlisted.
 * Returns the inserted account row.
 */
export async function createAccountWithSlot(
  pool, { pend, termsVersion }, { beta = betaMode(), max = betaMaxAccounts() } = {},
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock($1)", [BETA_LOCK_KEY]);
    const { rows: counts } = await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE role <> 'admin')::int AS non_admin
         FROM accounts`);
    const role = counts[0].total === 0 ? "admin" : "user";
    const waitlisted = shouldWaitlist({
      beta, role, nonAdminCount: counts[0].non_admin, max,
    });
    const { rows } = await db.query(
      `INSERT INTO accounts (email, email_lower, password_hash, cf_handle, role,
                             email_verified, email_verified_at,
                             terms_accepted_at, terms_accepted_version,
                             beta_waitlisted)
       VALUES ($1,$2,$3,$4,$5, true, now(), now(), $6, $7)
       RETURNING *`,
      [pend.email, pend.email_lower, pend.password_hash, pend.cf_handle, role,
       termsVersion, waitlisted]);
    await db.query("COMMIT");
    return rows[0];
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/* ── request gating ──────────────────────────────────────────────────────── */

const normalize = (p) =>
  String(p || "/").toLowerCase().replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");

// What a waitlisted account may still call: seeing who it is, signing in and
// out, changing its password, and the public config. Everything else under
// /api is refused. Keys are "METHOD path"; HEAD is treated as GET.
const WAITLIST_ALLOWED = new Set([
  "GET /api/auth/me",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/signup",
  "POST /api/auth/signup/confirm",
  "POST /api/auth/signup/resend",
  "POST /api/auth/forgot",
  "GET /api/auth/reset/check",
  "POST /api/auth/reset",
  "POST /api/auth/password",
  "GET /api/beta-config",
  // Public and account-independent; blocking them would only break the
  // homepage and clock check for a signed-in waitlisted user.
  "GET /api/config",
  "GET /api/time",
  "GET /api/stats",
]);

/** True for routes that are switched off for EVERYONE while in beta. */
function betaDisabledRoute(method, p) {
  if (method === "POST" && p === "/api/coach") return true;
  if (p === "/api/me/coach" || p.startsWith("/api/me/coach/")) return true;
  if (p === "/api/payments" || p.startsWith("/api/payments/")) return true;
  return false;
}

/** Analysis routes that cost real compute. In beta they need a signed-in
 *  account, otherwise the account cap could be skipped by calling them bare. */
const needsSignIn = (method, p) =>
  method === "GET" && (p.startsWith("/api/ml/analyze/") || p.startsWith("/api/cf/"));

/**
 * Decide whether a request is refused during beta. Returns null to let it
 * through, or {status, body} to respond with. `beta` is passed in so the
 * function stays pure. `accountsEnabled` is false in the no-database
 * deployment, where nobody can sign in and anonymous use must keep working.
 */
export function betaBlock({ beta, method, path, user, accountsEnabled = true }) {
  if (!beta) return null;
  const m = String(method || "GET").toUpperCase() === "HEAD"
    ? "GET" : String(method || "GET").toUpperCase();
  const p = normalize(path);
  // Only the API is gated; the SPA shell and static assets must still load so
  // the waitlist screen can render.
  if (p !== "/api" && !p.startsWith("/api/")) return null;

  if (user?.beta_waitlisted && !WAITLIST_ALLOWED.has(`${m} ${p}`)) {
    return {
      status: 403,
      body: {
        error: "Your account is on the waitlist. CFAnalyzer is in a limited "
             + "beta, and we will email you when it is released.",
        code: "BETA_WAITLISTED",
      },
    };
  }
  if (accountsEnabled && !user && needsSignIn(m, p)) {
    return {
      status: 401,
      body: { error: "Sign in to run an analysis.", code: "AUTH_REQUIRED" },
    };
  }
  if (betaDisabledRoute(m, p)) {
    return {
      status: 403,
      body: {
        error: "Plus and the AI Coach are not available during the beta.",
        code: "BETA_DISABLED",
      },
    };
  }
  return null;
}

/** Express middleware: mount AFTER attachUser so req.user is populated.
 *  Pass the real ACCOUNTS_ENABLED so the no-database mode stays anonymous. */
export const makeBetaGate = (accountsEnabled = true) => (req, res, next) => {
  const blocked = betaBlock({
    beta: betaMode(), method: req.method, path: req.path, user: req.user,
    accountsEnabled,
  });
  if (!blocked) return next();
  res.status(blocked.status).json(blocked.body);
};
export const betaGate = makeBetaGate(true);

/* ── schema ──────────────────────────────────────────────────────────────── */

/**
 * Add accounts.beta_waitlisted and flag the accounts that were already over
 * the cap. Idempotent, and the backfill runs ONLY in the run that adds the
 * column: later boots find the column and do nothing. A backfill that ran every
 * boot would keep re-ranking accounts as admins and deletions shift the order,
 * un-flagging people who were told they were waitlisted (or the reverse).
 *
 * Column and backfill share one transaction under the signup lock, so a crash
 * cannot leave the column added but unevaluated (which the next boot would
 * then skip), and a concurrent signup cannot slip in between.
 *
 * Deliberately not in schema.sql: that file is plain SQL, and the cap comes
 * from an environment variable.
 *
 * `pool` is anything with connect() (a pg Pool).
 */
export async function ensureBetaSchema(pool, max = betaMaxAccounts()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [BETA_LOCK_KEY]);
    const { rowCount } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'accounts' AND column_name = 'beta_waitlisted'`);
    let flagged = null;
    if (!rowCount) {
      await client.query(
        `ALTER TABLE accounts
           ADD COLUMN IF NOT EXISTS beta_waitlisted BOOLEAN NOT NULL DEFAULT false`);
      const r = await client.query(
        `UPDATE accounts SET beta_waitlisted = true
          WHERE id IN (
            SELECT id FROM (
              SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
                FROM accounts WHERE role <> 'admin'
            ) ranked WHERE rn > $1)`,
        [max]);
      flagged = r.rowCount;
    }
    await client.query("COMMIT");
    return { added: !rowCount, flagged };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
