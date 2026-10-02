// Closed-beta tests. Dependency-free (node:test). Nothing here touches Resend,
// Anthropic or Codeforces: mail is exercised only with RESEND_API_KEY unset, and
// the Postgres tests run only when TEST_DATABASE_URL points at a throwaway DB.
//
//   npm test                                   (from website/)
//   TEST_DATABASE_URL=postgres://... npm test  (adds the DB tests)

import test from "node:test";
import assert from "node:assert/strict";
import {
  betaMode, betaMaxAccounts, betaConfig, shouldWaitlist, betaBlock, betaGate, makeBetaGate,
} from "../services/beta.js";

/* ── config ─────────────────────────────────────────────────────────────── */

test("BETA_MODE defaults on; only false/0/off turn it off", () => {
  assert.equal(betaMode({}), true);
  assert.equal(betaMode({ BETA_MODE: "" }), true);
  assert.equal(betaMode({ BETA_MODE: "true" }), true);
  assert.equal(betaMode({ BETA_MODE: "yes" }), true);
  for (const v of ["false", "0", "off", "OFF", " False "]) {
    assert.equal(betaMode({ BETA_MODE: v }), false, v);
  }
});

test("BETA_MAX_ACCOUNTS defaults to 100 and rejects junk", () => {
  assert.equal(betaMaxAccounts({}), 100);
  assert.equal(betaMaxAccounts({ BETA_MAX_ACCOUNTS: "25" }), 25);
  assert.equal(betaMaxAccounts({ BETA_MAX_ACCOUNTS: "abc" }), 100);
  assert.equal(betaMaxAccounts({ BETA_MAX_ACCOUNTS: "-3" }), 100);
});

test("beta-config contract", () => {
  assert.deepEqual(betaConfig({}), { beta: true, maxAccounts: 100 });
  assert.deepEqual(betaConfig({ BETA_MODE: "off", BETA_MAX_ACCOUNTS: "5" }),
                   { beta: false, maxAccounts: 5 });
});

/* ── slot decision ──────────────────────────────────────────────────────── */

test("slot 100 is admitted, slot 101 is waitlisted", () => {
  const base = { beta: true, max: 100, role: "user" };
  assert.equal(shouldWaitlist({ ...base, nonAdminCount: 0 }), false);
  assert.equal(shouldWaitlist({ ...base, nonAdminCount: 99 }), false);  // the 100th
  assert.equal(shouldWaitlist({ ...base, nonAdminCount: 100 }), true);   // the 101st
  assert.equal(shouldWaitlist({ ...base, nonAdminCount: 5000 }), true);
});

test("BETA_MODE off never waitlists", () => {
  assert.equal(shouldWaitlist({ beta: false, nonAdminCount: 10_000, max: 100 }), false);
});

test("admins are never waitlisted", () => {
  assert.equal(shouldWaitlist({ beta: true, nonAdminCount: 500, max: 100, role: "admin" }), false);
});

/* ── middleware decision ────────────────────────────────────────────────── */

const waitlisted = { id: "u1", role: "user", beta_waitlisted: true };
const member = { id: "u2", role: "user", beta_waitlisted: false };
const admin = { id: "a1", role: "admin", beta_waitlisted: false };
const block = (method, path, user, beta = true, accountsEnabled = true) =>
  betaBlock({ beta, method, path, user, accountsEnabled });

test("waitlisted users are refused on feature routes", () => {
  for (const [m, p] of [
    ["GET", "/api/ml/analyze/tourist"], ["GET", "/api/cf/tourist"],
    ["POST", "/api/coach"], ["GET", "/api/coach/config"],
    ["GET", "/api/me/searches"], ["GET", "/api/me/searches/4"],
    ["POST", "/api/me/coach/pin"], ["GET", "/api/payments/config"],
    ["POST", "/api/payments/instapay"], ["GET", "/api/admin/users"],
    ["PATCH", "/api/auth/me"], ["GET", "/api/discounts/X"],
    ["GET", "/API/ML/ANALYZE/tourist"],        // Express routing is case-insensitive
    ["GET", "/api/ml/analyze/tourist/"],
  ]) {
    const r = block(m, p, waitlisted);
    assert.equal(r?.status, 403, `${m} ${p}`);
    assert.equal(r.body.code, "BETA_WAITLISTED", `${m} ${p}`);
    assert.ok(r.body.error);
  }
});

test("waitlisted users keep the allow-list", () => {
  for (const [m, p] of [
    ["GET", "/api/auth/me"], ["HEAD", "/api/auth/me"],
    ["POST", "/api/auth/login"], ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/signup"], ["POST", "/api/auth/signup/confirm"],
    ["POST", "/api/auth/forgot"], ["POST", "/api/auth/reset"],
    ["POST", "/api/auth/password"], ["GET", "/api/beta-config"],
    ["GET", "/api/config"], ["GET", "/health"], ["GET", "/"], ["GET", "/assets/x.js"],
  ]) {
    assert.equal(block(m, p, waitlisted), null, `${m} ${p}`);
  }
});

test("non-waitlisted users reach feature routes (anonymous only the public ones)", () => {
  for (const u of [member, admin, null]) {
    if (u) assert.equal(block("GET", "/api/ml/analyze/tourist", u), null);
    assert.equal(block("GET", "/api/me/searches", u), null);
    assert.equal(block("GET", "/api/coach/config", u), null);
  }
  assert.equal(block("GET", "/api/admin/users", admin), null);
});

test("anonymous analyze / cf are refused in beta when accounts are enabled", () => {
  for (const p of ["/api/ml/analyze/tourist", "/api/cf/tourist", "/API/CF/tourist/"]) {
    const r = block("GET", p, null);
    assert.equal(r?.status, 401, p);
    assert.deepEqual(r.body, { error: "Sign in to run an analysis.", code: "AUTH_REQUIRED" });
  }
  // Other public routes are untouched.
  assert.equal(block("GET", "/api/ml/version", null), null);
  assert.equal(block("GET", "/api/coach/config", null), null);
});

test("anonymous analyze / cf stay open without a DB, with beta off, or when signed in", () => {
  assert.equal(block("GET", "/api/ml/analyze/tourist", null, true, false), null);
  assert.equal(block("GET", "/api/cf/tourist", null, true, false), null);
  assert.equal(block("GET", "/api/ml/analyze/tourist", null, false), null);
  assert.equal(block("GET", "/api/cf/tourist", null, false), null);
  assert.equal(block("GET", "/api/ml/analyze/tourist", member), null);
  assert.equal(block("GET", "/api/cf/tourist", admin), null);
});

test("waitlisted check comes before the sign-in check", () => {
  assert.equal(block("GET", "/api/ml/analyze/tourist", waitlisted).body.code, "BETA_WAITLISTED");
  assert.equal(block("GET", "/api/cf/tourist", waitlisted).status, 403);
});

test("makeBetaGate(false) lets anonymous analysis through (no-DB deployment)", () => {
  const saved = process.env.BETA_MODE;
  delete process.env.BETA_MODE;
  try {
    const run = (gate) => {
      const out = { nexted: false, status: null, body: null };
      const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
      gate({ method: "GET", path: "/api/ml/analyze/x", user: null }, res, () => { out.nexted = true; });
      return out;
    };
    assert.equal(run(makeBetaGate(false)).nexted, true);
    const o = run(makeBetaGate(true));
    assert.equal(o.status, 401);
    assert.equal(o.body.code, "AUTH_REQUIRED");
  } finally {
    if (saved === undefined) delete process.env.BETA_MODE; else process.env.BETA_MODE = saved;
  }
});

test("coach and payments are BETA_DISABLED for everyone", () => {
  for (const u of [member, admin, null]) {
    for (const [m, p] of [
      ["POST", "/api/coach"], ["POST", "/api/me/coach/pin"],
      ["GET", "/api/me/coach/pinned"], ["POST", "/api/me/coach/day"],
      ["GET", "/api/payments/config"], ["POST", "/api/payments/instapay"],
      ["POST", "/api/payments/redeem-free"], ["GET", "/api/payments/mine"],
    ]) {
      const r = block(m, p, u);
      assert.equal(r?.status, 403, `${m} ${p}`);
      assert.equal(r.body.code, "BETA_DISABLED", `${m} ${p}`);
    }
  }
});

test("admin payment review stays available", () => {
  assert.equal(block("GET", "/api/admin/payments", admin), null);
  assert.equal(block("POST", "/api/admin/payments/3/approve", admin), null);
});

test("a waitlisted user hitting coach gets BETA_WAITLISTED, not BETA_DISABLED", () => {
  assert.equal(block("POST", "/api/coach", waitlisted).body.code, "BETA_WAITLISTED");
});

test("BETA_MODE off restores today's behaviour exactly", () => {
  for (const u of [waitlisted, member, admin, null]) {
    for (const [m, p] of [
      ["POST", "/api/coach"], ["GET", "/api/payments/config"],
      ["GET", "/api/ml/analyze/tourist"], ["POST", "/api/me/coach/pin"],
    ]) {
      assert.equal(block(m, p, u, false), null, `${m} ${p}`);
    }
  }
});

test("betaGate middleware responds or calls next (fake req/res)", () => {
  const saved = process.env.BETA_MODE;
  const run = (req) => {
    const out = { nexted: false, status: null, body: null };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    betaGate(req, res, () => { out.nexted = true; });
    return out;
  };
  try {
    delete process.env.BETA_MODE;
    let o = run({ method: "GET", path: "/api/ml/analyze/x", user: waitlisted });
    assert.equal(o.nexted, false);
    assert.equal(o.status, 403);
    assert.equal(o.body.code, "BETA_WAITLISTED");

    o = run({ method: "GET", path: "/api/auth/me", user: waitlisted });
    assert.equal(o.nexted, true);

    o = run({ method: "POST", path: "/api/coach", user: member });
    assert.equal(o.body.code, "BETA_DISABLED");

    process.env.BETA_MODE = "off";
    o = run({ method: "POST", path: "/api/coach", user: waitlisted });
    assert.equal(o.nexted, true);
  } finally {
    if (saved === undefined) delete process.env.BETA_MODE; else process.env.BETA_MODE = saved;
  }
});

/* ── mail ───────────────────────────────────────────────────────────────── */

test("waitlist email: without a Resend key it reports, never throws or sends", async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const { sendBetaWaitlistNotice } = await import("../services/mail.js");
    const r = await sendBetaWaitlistNotice("someone@example.com");
    assert.deepEqual(r, { ok: false, error: "MAIL_NOT_CONFIGURED" });
  } finally {
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  }
});

/* ── Postgres (opt-in) ──────────────────────────────────────────────────── */

const DB_URL = process.env.TEST_DATABASE_URL;
const dbTest = DB_URL ? test : test.skip;

dbTest("backfill runs once; concurrent confirms for the last slot admit exactly one", async () => {
  const { default: pg } = await import("pg");
  const { ensureBetaSchema, createAccountWithSlot } = await import("../services/beta.js");
  const schema = `beta_test_${process.pid}`;
  // Everything runs in a private schema so a real database is never touched.
  const pool = new pg.Pool({
    connectionString: DB_URL, max: 10, options: `-c search_path=${schema}`,
  });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL, email_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, cf_handle TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', plan TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      email_verified BOOLEAN NOT NULL DEFAULT true, email_verified_at TIMESTAMPTZ,
      terms_accepted_at TIMESTAMPTZ, terms_accepted_version TEXT)`);
    // 1 admin + 5 users that predate the column; cap of 3 -> users 4 and 5 flagged.
    await pool.query(`INSERT INTO accounts (email,email_lower,password_hash,cf_handle,role,created_at)
      SELECT 'u'||g||'@x.io','u'||g||'@x.io','h','h'||g,
             CASE WHEN g=0 THEN 'admin' ELSE 'user' END,
             now() - ((10-g) || ' minutes')::interval
        FROM generate_series(0,5) g`);

    const first = await ensureBetaSchema(pool, 3);
    assert.deepEqual(first, { added: true, flagged: 2 });
    const flagged = async () => (await pool.query(
      `SELECT email FROM accounts WHERE beta_waitlisted ORDER BY email`)).rows.map(r => r.email);
    assert.deepEqual(await flagged(), ["u4@x.io", "u5@x.io"]);

    // A second boot, even with a different cap, must not re-evaluate anyone.
    const second = await ensureBetaSchema(pool, 1);
    assert.deepEqual(second, { added: false, flagged: null });
    assert.deepEqual(await flagged(), ["u4@x.io", "u5@x.io"]);

    // 5 non-admins exist; cap 6 leaves exactly one slot. Fire 5 confirms at once.
    const pend = (i) => ({ email: `n${i}@x.io`, email_lower: `n${i}@x.io`,
      password_hash: "h", cf_handle: `n${i}` });
    const made = await Promise.all([1, 2, 3, 4, 5].map(
      (i) => createAccountWithSlot(pool, { pend: pend(i), termsVersion: "t" },
                                   { beta: true, max: 6 })));
    assert.equal(made.filter((a) => !a.beta_waitlisted).length, 1);
    assert.equal(made.filter((a) => a.beta_waitlisted).length, 4);
    assert.ok(made.every((a) => a.role === "user"));

    // Beta off: nobody is waitlisted regardless of count.
    const off = await createAccountWithSlot(pool, { pend: pend(9), termsVersion: "t" },
                                            { beta: false, max: 6 });
    assert.equal(off.beta_waitlisted, false);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
