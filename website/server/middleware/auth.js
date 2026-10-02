// Session-based authentication and role gating.
//
// Sessions are opaque random tokens stored server-side (hashed). That costs one
// DB round-trip per request but means logout and suspension take effect
// immediately, which a stateless JWT cannot do before it expires.

import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { query } from "../db/pool.js";

const SESSION_DAYS = 30;
export const COOKIE_NAME = "cfa_session";

const hashToken = (t) => createHash("sha256").update(t).digest("hex");

export function cookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,               // not readable by JS — blunts XSS token theft
    secure,                       // HTTPS only in production
    sameSite: "lax",              // survives top-level navigation, blocks CSRF POSTs
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(accountId, req) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await query(
    `INSERT INTO sessions (token_hash, account_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), accountId, expires,
     (req.get("user-agent") || "").slice(0, 400), clientIp(req)]
  );
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export function clientIp(req) {
  // Railway sits behind a proxy; trust the first hop only.
  const fwd = req.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : req.ip || "").slice(0, 64);
}

/** Resolve the session cookie to an account, or null. Never throws. */
export async function currentUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const { rows } = await query(
      `SELECT a.id, a.email, a.cf_handle, a.role, a.plan, a.status,
              a.full_name, a.phone, a.country, a.institution, a.bio,
              a.created_at, a.last_login_at,
              -- The quota columns must be here: the window helpers read them
              -- off req.user, and a missing column silently reads as "never
              -- used", which grants an unlimited allowance.
              a.plus_expires_at, a.cf_handle_changed_at, a.other_handle_run_at,
              a.email_verified, a.beta_waitlisted
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    const user = rows[0] || null;
    if (!user) return null;
    if (user.status === "suspended") return null;
    return user;
  } catch (err) {
    console.error("currentUser failed:", err.message);
    return null;
  }
}

/** Attach req.user when a valid session exists. Does not block anonymous use. */
export async function attachUser(req, _res, next) {
  req.user = await currentUser(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not signed in" });
  if (req.user.role !== "admin") {
    // 404 rather than 403: don't confirm the admin surface exists.
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

/** Recent failed logins for an email or IP, used to throttle credential stuffing. */
export async function recentFailures(emailLower, ip) {
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE email_lower = $1) AS by_email,
       count(*) FILTER (WHERE ip = $2)          AS by_ip
     FROM login_attempts
     WHERE ok = false AND at > now() - interval '15 minutes'`,
    [emailLower, ip]
  );
  return { byEmail: Number(rows[0].by_email), byIp: Number(rows[0].by_ip) };
}

export async function recordAttempt(emailLower, ip, ok) {
  await query(
    `INSERT INTO login_attempts (email_lower, ip, ok) VALUES ($1, $2, $3)`,
    [emailLower, ip, ok]
  );
}

/** Best-effort cleanup of expired sessions and stale attempt rows. */
export async function pruneExpired() {
  try {
    await query(`DELETE FROM sessions WHERE expires_at < now()`);
    await query(`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`);
  } catch (err) {
    console.error("prune failed:", err.message);
  }
}
