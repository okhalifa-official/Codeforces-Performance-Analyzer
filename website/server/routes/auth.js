// Sign-up, sign-in, sign-out, profile.

import express from "express";
import { z } from "zod";
import fetch from "node-fetch";
import { query } from "../db/pool.js";
import {
  COOKIE_NAME, cookieOptions, hashPassword, verifyPassword,
  createSession, destroySession, requireAuth, clientIp,
  recentFailures, recordAttempt,
} from "../middleware/auth.js";
import {
  handleChangeWindow, otherHandleWindow, waitMessage, OWN_HANDLE_PER_WEEK,
} from "../services/quotas.js";
import {
  sendWindow, recordSend, issueToken, consumeToken, recordFailedAttempt,
  passwordResetWindow, recordPasswordReset,
  RESEND_COOLDOWN_MS, SENDS_PER_DAY, domainCanReceiveMail, newCode,
  CODE_TTL_MS, MAX_CODE_ATTEMPTS,
} from "../services/emailAuth.js";
import { createHash } from "node:crypto";
import {
  sendVerificationCode, sendPasswordReset, sendBetaWaitlistNotice, mailConfigured,
} from "../services/mail.js";
import { createAccountWithSlot } from "../services/beta.js";
import { getPool } from "../db/pool.js";

// Bumped when the terms change, so it is visible which version each account
// agreed to. Acceptance is implicit in creating an account, which the sign-up
// form states next to the button.
export const TERMS_VERSION = "2026-09-27";

const router = express.Router();

// Only the three required fields are mandatory. Everything else is optional and
// can be filled in later from the profile page.
const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  cf_handle: z.string().trim()
    .min(1, "Codeforces handle is required")
    .max(48)
    .regex(/^[A-Za-z0-9_.-]+$/, "Handles use letters, digits, dot, dash or underscore"),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

// `email` is deliberately absent: an address is verified once and then fixed.
// Allowing a change would let a verified account become an unverified one, or
// be moved to an address someone else controls, and it is the identifier for
// payments and password resets. Changes go through a human.
const profileSchema = z.object({
  full_name:   z.string().trim().max(120).optional().nullable(),
  phone:       z.string().trim().max(40).optional().nullable(),
  country:     z.string().trim().max(80).optional().nullable(),
  institution: z.string().trim().max(120).optional().nullable(),
  bio:         z.string().trim().max(600).optional().nullable(),
  cf_handle:   z.string().trim().min(1).max(48)
                .regex(/^[A-Za-z0-9_.-]+$/).optional(),
});

const publicUser = (u) => ({
  id: u.id, email: u.email, cf_handle: u.cf_handle, role: u.role,
  email_verified: u.email_verified !== false,
  // Closed beta: over the account cap, signed in but not allowed to use
  // anything. Strictly boolean so the client never sees null/undefined.
  beta_waitlisted: u.beta_waitlisted === true,
  plan: u.plan, full_name: u.full_name, phone: u.phone, country: u.country,
  institution: u.institution, bio: u.bio, created_at: u.created_at,
  plus_expires_at: u.plus_expires_at ?? null,
  // Admins are exempt from both limits, so the client is told as much rather
  // than being shown a countdown that does not apply to them.
  limits: u.role === "admin" ? null : {
    handle_change: handleChangeWindow(u),
    other_handle:  otherHandleWindow(u),
    // The allowance only; how much is left needs a query, so the dashboard
    // reads that from the analyse response instead.
    own_handle_per_week: OWN_HANDLE_PER_WEEK[u.plan === "pro" ? "pro" : "free"],
  },
});

/** Confirm the handle exists on Codeforces, so a typo is caught at sign-up. */
async function codeforcesHandleExists(handle) {
  try {
    const r = await fetch(
      `https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`,
      { timeout: 8000 }
    );
    const j = await r.json();
    return j.status === "OK" && Array.isArray(j.result) && j.result.length > 0;
  } catch {
    // If Codeforces is unreachable, do not block sign-up on it.
    return true;
  }
}

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

/** Create a pending signup and email its code. No account exists until the
 *  code is confirmed, so an address nobody controls leaves nothing behind. */
router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, cf_handle } = parsed.data;
  const emailLower = email.toLowerCase();

  try {
    const exists = await query(
      `SELECT 1 FROM accounts WHERE email_lower = $1`, [emailLower]);
    if (exists.rowCount) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Reject domains that cannot receive mail before spending a send on them.
    // This catches typos and invented domains; it cannot tell whether the
    // mailbox itself exists, which is what the code proves.
    const reachable = await domainCanReceiveMail(email);
    if (!reachable.ok) {
      return res.status(400).json({
        error: reachable.reason === "UNROUTABLE_TLD"
          ? "That domain cannot receive email. Use an address you can open."
          : "We could not find a mail server for that address. Check the spelling.",
        code: "EMAIL_UNDELIVERABLE",
      });
    }

    if (!(await codeforcesHandleExists(cf_handle))) {
      return res.status(400).json({
        error: `Codeforces has no user named "${cf_handle}". Check the spelling.`,
      });
    }

    if (!mailConfigured()) {
      return res.status(503).json({
        error: "Sign-up is unavailable right now: we cannot send verification "
             + "codes. Try again shortly.",
        code: "MAIL_NOT_CONFIGURED",
      });
    }

    // The per-address send limits apply here too, so signup cannot be used to
    // mail someone repeatedly.
    const w = await sendWindow(emailLower, "verify");
    if (!w.allowed) {
      return res.status(429).json({
        error: w.reason === "DAILY_LIMIT"
          ? `That address has already been sent ${SENDS_PER_DAY} codes today.`
          : `A code was just sent. Wait ${w.retry_after_seconds}s before asking for another.`,
        code: w.reason,
        retry_after_seconds: w.retry_after_seconds,
      });
    }

    const password_hash = await hashPassword(password);
    const code = newCode();

    // Upsert: signing up twice with the same address replaces the pending row
    // and its code rather than erroring, which is what someone retrying after
    // a mistyped code expects.
    await query(
      `INSERT INTO pending_signups
         (email, email_lower, password_hash, cf_handle, code_hash,
          terms_version, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' milliseconds')::interval)
       ON CONFLICT (email_lower) DO UPDATE SET
         email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
         cf_handle = EXCLUDED.cf_handle, code_hash = EXCLUDED.code_hash,
         terms_version = EXCLUDED.terms_version,
         expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
      [email, emailLower, password_hash, cf_handle, sha256(code),
       TERMS_VERSION, String(CODE_TTL_MS)]);

    const sent = await sendVerificationCode(email, code);
    await recordSend(null, emailLower, "verify", sent.ok);
    if (!sent.ok) {
      // Nothing was created, so the address stays free to try again.
      await query(`DELETE FROM pending_signups WHERE email_lower = $1`, [emailLower]);
      return res.status(502).json({
        error: "We could not send a code to that address. Check it and try again.",
        code: "SEND_FAILED",
      });
    }

    // Deliberately no session: there is no account to sign in to yet.
    res.status(202).json({
      pending: true,
      email,
      message: "Enter the 6-digit code we sent to finish creating your account.",
    });
  } catch (err) {
    console.error("signup failed:", err.message);
    res.status(500).json({ error: "Could not start sign-up. Try again." });
  }
});

/** Confirm a pending signup's code — this is where the account is created. */
router.post("/signup/confirm", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code  = String(req.body?.code  || "").replace(/\D/g, "");
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }

  try {
    const { rows } = await query(
      `SELECT * FROM pending_signups WHERE email_lower = $1`, [email]);
    const pend = rows[0];
    if (!pend || new Date(pend.expires_at) < new Date()) {
      return res.status(400).json({
        error: "That code has expired. Start sign-up again.",
        code: "EXPIRED",
      });
    }
    if (pend.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        error: "Too many wrong codes. Start sign-up again.",
        code: "TOO_MANY_ATTEMPTS",
      });
    }
    if (pend.code_hash !== sha256(code)) {
      await query(
        `UPDATE pending_signups SET attempts = attempts + 1 WHERE id = $1`,
        [pend.id]);
      return res.status(400).json({
        error: "That code is not right.", code: "BAD_CODE",
      });
    }

    // Race guard: deleting the pending row first means only one request can
    // proceed to create the account.
    const claim = await query(
      `DELETE FROM pending_signups WHERE id = $1 RETURNING id`, [pend.id]);
    if (!claim.rowCount) {
      return res.status(409).json({ error: "That code was just used." });
    }

    // Count and insert in one transaction under an advisory lock, so two
    // confirms racing for the last beta slot cannot both get in.
    const user = await createAccountWithSlot(getPool(), {
      pend, termsVersion: pend.terms_version || TERMS_VERSION,
    });

    // Tell a waitlisted user what happens next. The account already exists, so
    // a mail failure is logged and never fails the sign-up.
    if (user.beta_waitlisted) {
      try {
        const sent = await sendBetaWaitlistNotice(user.email);
        if (!sent.ok) console.error("beta waitlist email not sent:", sent.error);
      } catch (err) {
        console.error("beta waitlist email failed:", err.message);
      }
    }

    const token = await createSession(user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    console.error("signup confirm failed:", err.message);
    res.status(500).json({ error: "Could not finish sign-up. Try again." });
  }
});

/** Resend the code for a pending signup. */
router.post("/signup/resend", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = { ok: true };
  if (!email) return res.status(400).json({ error: "Enter your email address." });

  const w = await sendWindow(email, "verify");
  if (!w.allowed) {
    return res.status(429).json({
      error: w.reason === "DAILY_LIMIT"
        ? `You can request ${SENDS_PER_DAY} codes a day. Try again tomorrow.`
        : `Wait ${w.retry_after_seconds}s before asking for another code.`,
      code: w.reason,
      retry_after_seconds: w.retry_after_seconds,
    });
  }
  try {
    const { rows } = await query(
      `SELECT * FROM pending_signups WHERE email_lower = $1`, [email]);
    const pend = rows[0];
    // Answer the same way whether or not a pending signup exists, so this
    // cannot be used to discover which addresses are mid-signup.
    if (!pend) { await recordSend(null, email, "verify", true); return res.json(generic); }

    const code = newCode();
    await query(
      `UPDATE pending_signups
          SET code_hash = $2, attempts = 0,
              expires_at = now() + ($3 || ' milliseconds')::interval
        WHERE id = $1`,
      [pend.id, sha256(code), String(CODE_TTL_MS)]);
    const sent = await sendVerificationCode(pend.email, code);
    await recordSend(null, email, "verify", sent.ok);
    res.json(generic);
  } catch (err) {
    console.error("signup resend failed:", err.message);
    res.json(generic);
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter your email and password" });
  }
  const { email, password } = parsed.data;
  const emailLower = email.toLowerCase();
  const ip = clientIp(req);

  try {
    const fails = await recentFailures(emailLower, ip);
    if (fails.byEmail >= 8 || fails.byIp >= 25) {
      return res.status(429).json({
        error: "Too many failed attempts. Wait 15 minutes and try again.",
      });
    }

    const { rows } = await query(
      `SELECT * FROM accounts WHERE email_lower = $1`, [emailLower]);
    const user = rows[0];

    // Always run a comparison so a missing account and a wrong password take
    // the same time — otherwise response timing reveals which emails exist.
    const hash = user?.password_hash
      || "$2a$12$" + "x".repeat(53);
    const ok = await verifyPassword(password, hash);

    if (!user || !ok) {
      await recordAttempt(emailLower, ip, false);
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if (user.status === "suspended") {
      await recordAttempt(emailLower, ip, false);
      return res.status(403).json({
        error: "This account has been suspended. Contact support.",
      });
    }

    await recordAttempt(emailLower, ip, true);
    await query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [user.id]);
    const token = await createSession(user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("login failed:", err.message);
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
});

router.post("/logout", async (req, res) => {
  await destroySession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const fields = parsed.data;

  const changingHandle =
    fields.cf_handle &&
    fields.cf_handle.toLowerCase() !== String(req.user.cf_handle).toLowerCase();

  if (changingHandle) {
    // A handle may be relinked once every 6 months. Admins are exempt: they
    // manage accounts and must be able to correct a wrong handle.
    if (req.user.role !== "admin") {
      const w = handleChangeWindow(req.user);
      if (!w.allowed) {
        return res.status(429).json({
          error: `Your Codeforces handle can only be changed once every `
               + `6 months. You can change it again ${waitMessage(w.days_remaining)}.`,
          code: "HANDLE_CHANGE_LOCKED",
          next_at: w.next_at,
          days_remaining: w.days_remaining,
        });
      }
    }
    if (!(await codeforcesHandleExists(fields.cf_handle))) {
      return res.status(400).json({
        error: `Codeforces has no user named "${fields.cf_handle}".`,
      });
    }
  } else if (fields.cf_handle) {
    // Same handle, possibly different capitalisation. Saving it must not
    // consume the 6-month allowance, so drop it from the update entirely.
    delete fields.cf_handle;
  }

  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return res.json({ user: publicUser(req.user) });

  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = keys.map((k) => (fields[k] === "" ? null : fields[k]));
  // One statement: the new handle and the spent allowance land together, so a
  // failure between them cannot leave a free extra change.
  const stamp = changingHandle && req.user.role !== "admin"
    ? ", cf_handle_changed_at = now()" : "";
  try {
    const { rows } = await query(
      `UPDATE accounts SET ${sets}, updated_at = now()${stamp}
        WHERE id = $1 RETURNING *`,
      [req.user.id, ...values]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error("profile update failed:", err.message);
    res.status(500).json({ error: "Could not save your changes." });
  }
});

/* ── email verification ──────────────────────────────────────────────────── */

const FEEDBACK_URL =
  "https://github.com/okhalifa-official/cf-performance-feedback/discussions";

/** Reject an attempt to change the email address, with somewhere to go. */
router.patch("/email", requireAuth, (_req, res) => {
  res.status(403).json({
    error: "Your email address cannot be changed here. Contact us on the "
         + "discussion channel and we will move it for you.",
    code: "EMAIL_LOCKED",
    contact_url: FEEDBACK_URL,
  });
});

/** State of the signed-in account's verification, for the banner. */
router.get("/verify/status", requireAuth, async (req, res) => {
  if (req.user.email_verified !== false) {
    return res.json({ verified: true });
  }
  const w = await sendWindow(String(req.user.email).toLowerCase(), "verify");
  res.json({
    verified: false,
    mail_configured: mailConfigured(),
    can_resend: w.allowed,
    retry_after_seconds: w.retry_after_seconds,
    remaining_today: w.remaining_today,
    sends_per_day: SENDS_PER_DAY,
    cooldown_seconds: RESEND_COOLDOWN_MS / 1000,
  });
});

/** Send another verification code. */
router.post("/verify/resend", requireAuth, async (req, res) => {
  if (req.user.email_verified !== false) {
    return res.json({ ok: true, already_verified: true });
  }
  const emailLower = String(req.user.email).toLowerCase();
  const w = await sendWindow(emailLower, "verify");
  if (!w.allowed) {
    return res.status(429).json({
      error: w.reason === "DAILY_LIMIT"
        ? `You can request ${SENDS_PER_DAY} codes a day. Try again tomorrow.`
        : `Wait ${w.retry_after_seconds}s before asking for another code.`,
      code: w.reason,
      retry_after_seconds: w.retry_after_seconds,
      remaining_today: w.remaining_today,
    });
  }
  if (!mailConfigured()) {
    return res.status(503).json({
      error: "Email is not configured yet, so codes cannot be sent.",
      code: "MAIL_NOT_CONFIGURED",
    });
  }
  const code = await issueToken(req.user.id, "verify");
  const r = await sendVerificationCode(req.user.email, code);
  // Counted whether or not it sent: otherwise a failing mailbox is an
  // unlimited retry loop.
  await recordSend(req.user.id, emailLower, "verify", r.ok);
  if (!r.ok) {
    return res.status(502).json({ error: "Could not send the code. Try again shortly." });
  }
  res.json({ ok: true, remaining_today: Math.max(0, w.remaining_today - 1) });
});

/** Confirm a code. */
router.post("/verify", requireAuth, async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }
  if (req.user.email_verified !== false) {
    return res.json({ user: publicUser(req.user), already_verified: true });
  }
  // Scoped to this account, so a code mailed to one user cannot verify another.
  const r = await consumeToken("verify", code, req.user.id);
  if (!r.ok) {
    await recordFailedAttempt(req.user.id, "verify");
    return res.status(400).json({
      error: "That code is wrong or has expired. Ask for a new one.",
      code: "BAD_CODE",
    });
  }
  const { rows } = await query(
    `UPDATE accounts SET email_verified = true, email_verified_at = now(),
                         updated_at = now()
      WHERE id = $1 RETURNING *`, [req.user.id]);
  res.json({ user: publicUser(rows[0]) });
});

/* ── password reset ──────────────────────────────────────────────────────── */

/** Request a reset link. Always answers the same way: whether an address has
 *  an account is not something an unauthenticated caller may learn. */
router.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const emailLower = email.toLowerCase();
  const generic = {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  // The window is checked on the address before any lookup, so the timing and
  // the response are identical for addresses that do and do not exist.
  const w = await sendWindow(emailLower, "reset");
  if (!w.allowed) {
    return res.status(429).json({
      error: w.reason === "DAILY_LIMIT"
        ? `You can request ${SENDS_PER_DAY} reset emails a day. Try again tomorrow.`
        : `Wait ${w.retry_after_seconds}s before asking for another link.`,
      code: w.reason,
      retry_after_seconds: w.retry_after_seconds,
    });
  }

  try {
    const { rows } = await query(
      `SELECT id, email FROM accounts WHERE email_lower = $1`, [emailLower]);
    const user = rows[0];

    // Logged for an unknown address too, so probing cannot be told apart from
    // a real request by its rate-limit behaviour.
    if (!user) {
      await recordSend(null, emailLower, "reset", true);
      return res.json(generic);
    }

    // Refuse before mailing if the account cannot reset anyway; sending a link
    // that is guaranteed to be rejected wastes the user's time.
    const rw = await passwordResetWindow(user.id);
    if (!rw.allowed) {
      await recordSend(user.id, emailLower, "reset", true);
      return res.json(generic);
    }

    const token = await issueToken(user.id, "reset");
    const r = await sendPasswordReset(user.email, token);
    await recordSend(user.id, emailLower, "reset", r.ok);
    return res.json(generic);
  } catch (err) {
    console.error("forgot failed:", err.message);
    return res.json(generic);
  }
});

/** Is a reset link still good? Lets the page show a clear message before the
 *  user types a new password. */
router.get("/reset/check", async (req, res) => {
  const token = String(req.query?.token || "");
  if (!token) return res.status(400).json({ valid: false });
  const { rows } = await query(
    `SELECT 1 FROM email_tokens
      WHERE token_hash = encode(digest($1, 'sha256'), 'hex')
        AND kind = 'reset' AND consumed_at IS NULL AND expires_at > now()`,
    [token]);
  res.json({ valid: rows.length > 0 });
});

/** Complete a reset. */
router.post("/reset", async (req, res) => {
  const token = String(req.body?.token || "");
  const next = String(req.body?.password || "");
  if (!token) return res.status(400).json({ error: "That link is not valid." });
  if (next.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  const claimed = await consumeToken("reset", token);
  if (!claimed.ok) {
    return res.status(400).json({
      error: "That link has expired or was already used. Request a new one.",
      code: "BAD_TOKEN",
    });
  }

  // The quota is checked after the token is claimed: the token proves the
  // request is genuine, and a refusal here must not leave the link reusable.
  const rw = await passwordResetWindow(claimed.accountId);
  if (!rw.allowed) {
    return res.status(429).json({
      error: rw.reason === "MONTHLY_LIMIT"
        ? "You have used all 5 password resets for this month."
        : `Passwords can be reset once a week. You can reset again in ${rw.days_remaining} days.`,
      code: rw.reason,
      next_at: rw.next_at,
    });
  }

  try {
    const hash = await hashPassword(next);
    await query(
      `UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [claimed.accountId, hash]);
    await recordPasswordReset(claimed.accountId);
    // Every existing session is dropped: if the reset was someone recovering a
    // compromised account, the intruder's session must not survive it.
    await query(`DELETE FROM sessions WHERE account_id = $1`, [claimed.accountId]);
    res.json({ ok: true, remaining_this_month: Math.max(0, rw.remaining - 1) });
  } catch (err) {
    console.error("reset failed:", err.message);
    res.status(500).json({ error: "Could not reset the password." });
  }
});

router.post("/password", requireAuth, async (req, res) => {
  const schema = z.object({
    current: z.string().min(1),
    next: z.string().min(8, "New password must be at least 8 characters").max(200),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const { rows } = await query(
      `SELECT password_hash FROM accounts WHERE id = $1`, [req.user.id]);
    if (!(await verifyPassword(parsed.data.current, rows[0].password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    await query(`UPDATE accounts SET password_hash = $2, updated_at = now()
                  WHERE id = $1`,
                [req.user.id, await hashPassword(parsed.data.next)]);
    // Invalidate other sessions after a password change.
    await query(`DELETE FROM sessions WHERE account_id = $1`, [req.user.id]);
    const token = await createSession(req.user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    console.error("password change failed:", err.message);
    res.status(500).json({ error: "Could not change the password." });
  }
});

export default router;
