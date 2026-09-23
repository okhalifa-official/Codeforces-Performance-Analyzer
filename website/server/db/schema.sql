-- Application schema: accounts, sessions, and search history.
--
-- Separate from the ML tables (scripts/db/schema.sql) but lives in the same
-- database. The weekly pipeline only ever touches submissions /
-- user_tag_strengths / user_profiles, so a retrain can never disturb accounts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    -- Case-insensitive uniqueness without CITEXT: store the normalized form.
    email_lower     TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    cf_handle       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
    plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended')),

    -- Optional profile, fillable later.
    full_name       TEXT,
    phone           TEXT,
    country         TEXT,
    institution     TEXT,
    bio             TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS accounts_cf_handle_idx ON accounts (lower(cf_handle));
CREATE INDEX IF NOT EXISTS accounts_created_idx   ON accounts (created_at DESC);

-- ── sessions ────────────────────────────────────────────────────────────────
-- Opaque server-side sessions rather than stateless JWTs: logging a user out
-- (or an admin suspending an account) must take effect immediately, which a
-- self-contained token cannot do before it expires.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,          -- sha256 of the cookie value
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT,
    ip           TEXT
);

CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx  ON sessions (expires_at);

-- ── searches ────────────────────────────────────────────────────────────────
-- One row per analysis a user runs. Admins review these; users see their own
-- history. Kept deliberately small — the full result is recomputed on demand,
-- only the headline numbers are stored.
CREATE TABLE IF NOT EXISTS searches (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id    UUID REFERENCES accounts(id) ON DELETE CASCADE,
    cf_handle     TEXT NOT NULL,
    searched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok            BOOLEAN NOT NULL DEFAULT true,
    duration_ms   INTEGER,
    cf_rating     INTEGER,
    weakest_tag   TEXT,
    error         TEXT,
    -- Per-topic scores for this run, so a user can compare today against an
    -- earlier analysis. Only the 20 numbers are kept, not the whole result:
    -- recommendations are regenerated on demand and would bloat the row.
    scores        JSONB
);

-- Adding the column to a database created before comparison existed.
ALTER TABLE searches ADD COLUMN IF NOT EXISTS scores JSONB;

-- The full result, so opening a past analysis re-renders it instead of
-- re-running the model (30-60s of work and real database egress). Profiling
-- and problem_attempts are stripped first — they are diagnostics, not part of
-- what the user sees. ~27 KB per run.
ALTER TABLE searches ADD COLUMN IF NOT EXISTS result JSONB;

CREATE INDEX IF NOT EXISTS searches_account_idx ON searches (account_id, searched_at DESC);
CREATE INDEX IF NOT EXISTS searches_time_idx    ON searches (searched_at DESC);

-- ── login throttling ────────────────────────────────────────────────────────
-- Credential stuffing protection: count recent failures per email and per IP.
CREATE TABLE IF NOT EXISTS login_attempts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email_lower TEXT,
    ip          TEXT,
    ok          BOOLEAN NOT NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email_lower, at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx    ON login_attempts (ip, at DESC);


-- ─── Discount codes ─────────────────────────────────────────────────────────
-- Admin-created promo codes for the Plus plan. A code is redeemable while it
-- is active, has not expired, and has uses left.
CREATE TABLE IF NOT EXISTS discount_codes (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          TEXT NOT NULL,
    -- Compared case-insensitively: people type promo codes in any case.
    code_upper    TEXT NOT NULL UNIQUE,
    percent_off   INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
    max_uses      INTEGER NOT NULL CHECK (max_uses > 0),
    used_count    INTEGER NOT NULL DEFAULT 0,
    expires_at    TIMESTAMPTZ NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT true,
    note          TEXT,
    created_by    UUID REFERENCES accounts(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One redemption row per account per code: the unique constraint is what stops
-- a user claiming the same code twice, including under concurrent requests.
CREATE TABLE IF NOT EXISTS discount_redemptions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code_id       BIGINT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    percent_off   INTEGER NOT NULL,
    redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (code_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_account
    ON discount_redemptions(account_id);


-- ─── App settings ───────────────────────────────────────────────────────────
-- Small key/value store for things an admin can change without a redeploy,
-- such as which Claude model the AI Coach runs on.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES accounts(id) ON DELETE SET NULL
);


-- One row per AI Coach plan generated, used to meter the free trial.
CREATE TABLE IF NOT EXISTS coach_uses (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    model      TEXT,
    used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_uses_account ON coach_uses(account_id);


-- ─── InstaPay subscriptions ─────────────────────────────────────────────────
-- Plus is sold as fixed-length passes paid by InstaPay transfer. InstaPay has
-- no recurring billing, so each verified transfer adds a term to the account's
-- expiry rather than starting a subscription that renews itself.
CREATE TABLE IF NOT EXISTS payments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plan_key          TEXT NOT NULL,              -- monthly | quarterly | biannual
    months            INTEGER NOT NULL,
    amount            NUMERIC(10,2) NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'EGP',
    discount_code_id  BIGINT REFERENCES discount_codes(id) ON DELETE SET NULL,
    percent_off       INTEGER,

    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected')),

    -- The reference printed on the InstaPay receipt. Unique across every
    -- non-rejected row: one transfer can only ever buy one term.
    instapay_reference TEXT,

    -- What the verifier read off the screenshot, and how it judged it.
    extracted         JSONB,
    checks            JSONB,
    auto_verdict      TEXT,                       -- verified | needs_review | rejected
    reasons           JSONB,

    screenshot_mime   TEXT,
    screenshot_bytes  INTEGER,

    reviewed_by       UUID REFERENCES accounts(id) ON DELETE SET NULL,
    reviewed_at       TIMESTAMPTZ,
    review_note       TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A reference may be reused only if every previous use was rejected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference_live
    ON payments (instapay_reference)
    WHERE instapay_reference IS NOT NULL AND status <> 'rejected';

CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_pending ON payments(status) WHERE status = 'pending';

-- When Plus lapses. NULL means the account has never had it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plus_expires_at TIMESTAMPTZ;

-- Which plans a discount code applies to. NULL means every plan, so codes
-- created before this column existed keep working unchanged.
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS applies_to TEXT[];

-- ── handle-change and cross-handle analysis limits ──────────────────────────
-- A Codeforces handle may only be relinked once every 6 months. Without this
-- an account could re-point itself at a new handle daily and use the per-handle
-- analysis quota as an unlimited pass. NULL means "never changed", so existing
-- accounts get their first change immediately rather than being locked out.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cf_handle_changed_at TIMESTAMPTZ;

-- Analysing a handle other than the linked one is metered: once every 3 months
-- on free, once a week on Plus. Stored on the account (not derived from
-- `searches`) so the allowance survives history pruning and so the window is
-- anchored to the grant, not to a row that may be deleted.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS other_handle_run_at TIMESTAMPTZ;

-- ── one transfer per account per day ────────────────────────────────────────
-- The route checks a rolling 24h window before spending money on verification;
-- this index is the guard that survives two concurrent submissions, which the
-- check alone cannot stop. It is per calendar day (UTC) because a unique index
-- needs a fixed expression -- so the two rules differ slightly at the boundary
-- and the stricter one wins, which is the safe direction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_per_day
    ON payments (account_id, (((created_at AT TIME ZONE 'UTC'))::date));

-- ── saved AI Coach plans ────────────────────────────────────────────────────
-- A plan belongs to the exact analysis it was written from: it cites that
-- run's problems and weak tags, so showing it beside a different run would be
-- wrong. Stored on the row rather than in a side table because there is
-- exactly one plan per run -- generating a second would silently replace work
-- the user already paid for.
ALTER TABLE searches ADD COLUMN IF NOT EXISTS coach_plan      TEXT;
ALTER TABLE searches ADD COLUMN IF NOT EXISTS coach_model     TEXT;
ALTER TABLE searches ADD COLUMN IF NOT EXISTS coach_written_at TIMESTAMPTZ;

-- ── email verification and password reset ───────────────────────────────────
-- Existing accounts are grandfathered in: they predate verification and must
-- not be locked out, so the column defaults to true and new signups are set
-- to false explicitly. A later migration cannot tell the two apart, which is
-- why the distinction is made at insert time rather than by a backfill.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Verification codes and reset tokens share a table: both are short-lived
-- single-use secrets sent to an email, and both need the same rate limiting.
-- `kind` keeps them apart. The secret is stored as a sha256 hash -- a database
-- leak must not hand out working reset links.
CREATE TABLE IF NOT EXISTS email_tokens (
    id           BIGSERIAL PRIMARY KEY,
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
    token_hash   TEXT NOT NULL,
    -- The 6-digit code is compared in the app, so only its hash lives here.
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    -- Wrong guesses, so a code cannot be brute-forced.
    attempts     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_lookup
    ON email_tokens (account_id, kind, created_at DESC);
-- Finding a token by its hash is the hot path for reset links.
CREATE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens (token_hash);

-- Every send attempt, kept whether or not it succeeded: the daily caps count
-- attempts, otherwise a failing mailbox would grant unlimited retries.
CREATE TABLE IF NOT EXISTS email_sends (
    id          BIGSERIAL PRIMARY KEY,
    account_id  UUID REFERENCES accounts(id) ON DELETE CASCADE,
    email_lower TEXT NOT NULL,
    kind        TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok          BOOLEAN NOT NULL DEFAULT true
);

-- The caps are "3 a day" and "one every 3 minutes", both scoped to an address
-- rather than an account, so requesting a reset for an address that has no
-- account cannot be used to probe which addresses exist.
CREATE INDEX IF NOT EXISTS idx_email_sends_window
    ON email_sends (email_lower, kind, sent_at DESC);

-- Completed password changes, which carry their own quota: 5 a month, the
-- first immediate and then one a week. Separate from email_sends because a
-- send is a request and this is a change that actually happened.
CREATE TABLE IF NOT EXISTS password_resets (
    id          BIGSERIAL PRIMARY KEY,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    reset_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_account
    ON password_resets (account_id, reset_at DESC);

-- Which version of the terms an account accepted, and when. Acceptance happens
-- at sign-up, so the column is set at insert; existing rows keep NULL, which
-- reads as "predates the terms" rather than "refused them".
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_accepted_version TEXT;

-- ── pending signups ─────────────────────────────────────────────────────────
-- A signup lives here until its code is confirmed; only then is a row created
-- in `accounts`. This keeps unverified addresses out of the real table, so a
-- mistyped or fabricated address cannot occupy an email forever and the
-- account count means something.
--
-- The password is stored already hashed, exactly as it would be in accounts:
-- this row is no more sensitive than the account it becomes.
CREATE TABLE IF NOT EXISTS pending_signups (
    id             BIGSERIAL PRIMARY KEY,
    email          TEXT NOT NULL,
    email_lower    TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    cf_handle      TEXT NOT NULL,
    code_hash      TEXT NOT NULL,
    attempts       INT NOT NULL DEFAULT 0,
    terms_version  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_signups_expiry
    ON pending_signups (expires_at);

-- ── pinned plan and day-by-day progress ─────────────────────────────────────
-- One pinned plan per account: the dashboard asks "what am I following this
-- week?", which has one answer. Pinning a new plan moves the pin.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pinned_search_id BIGINT
    REFERENCES searches(id) ON DELETE SET NULL;

-- Which days of a plan the student has ticked off.
--
-- One row per (plan, day) rather than a JSON blob on the plan: the admin view
-- needs "how many people finished day 4" and "which topics get skipped", and
-- those are aggregate queries over rows, not over documents.
--
-- The topic is copied in at tick time. It could be parsed back out of the
-- stored HTML, but denormalising it here is what makes the by-topic report a
-- GROUP BY instead of a scan-and-regex over every plan.
CREATE TABLE IF NOT EXISTS coach_day_progress (
    search_id    BIGINT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    account_id   UUID   NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day_number   INT    NOT NULL CHECK (day_number BETWEEN 1 AND 14),
    topic        TEXT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (search_id, day_number)
);

CREATE INDEX IF NOT EXISTS idx_coach_progress_account
    ON coach_day_progress (account_id, completed_at DESC);
-- Drives the per-day drop-off report.
CREATE INDEX IF NOT EXISTS idx_coach_progress_day
    ON coach_day_progress (day_number);
-- Drives the by-topic report.
CREATE INDEX IF NOT EXISTS idx_coach_progress_topic
    ON coach_day_progress (topic) WHERE topic IS NOT NULL;

-- How many days each plan has, so completion percentage has a denominator
-- without re-parsing the stored HTML on every query.
ALTER TABLE searches ADD COLUMN IF NOT EXISTS coach_day_count INT;

-- ── stored payment receipts ─────────────────────────────────────────────────
-- The terms promise receipts are kept so a payment can be reviewed and
-- disputed, so they are actually kept. Downscaled to ~800px before storing:
-- every field a dispute turns on (reference, amount, both parties, date) stays
-- legible at roughly a tenth of the original size.
--
-- Held for 24 months and then deleted by pruneExpiredReceipts(). The payment
-- row itself survives -- reference, amount and date are the accounting record
-- and are not personal banking imagery.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_data  BYTEA;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS screenshot_kept_until TIMESTAMPTZ;

-- Finding receipts due for deletion without scanning every payment.
CREATE INDEX IF NOT EXISTS idx_payments_receipt_expiry
    ON payments (screenshot_kept_until)
    WHERE screenshot_data IS NOT NULL;

-- ── refunds ─────────────────────────────────────────────────────────────────
-- A refund is recorded against the payment it reverses. InstaPay cannot be
-- reversed programmatically, so this records that a transfer was sent back by
-- hand -- it is the audit trail, not the mechanism.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at    TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_by    UUID REFERENCES accounts(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_note    TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount  NUMERIC(10,2);

-- 'refunded' is a fourth status. ADD COLUMN IF NOT EXISTS cannot widen an
-- existing CHECK, so the constraint is dropped and rebuilt -- idempotent, and
-- it runs on every boot without effect once the new form is in place.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending','approved','rejected','refunded'));
