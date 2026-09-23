// Admin surface: list, inspect, edit and delete accounts; review search activity.
// Every route sits behind requireAdmin.

import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin, hashPassword } from "../middleware/auth.js";
import { refundEligibility } from "../services/refunds.js";

const router = express.Router();
router.use(requireAdmin);

router.get("/stats", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM accounts)                                   AS total_users,
        (SELECT count(*) FROM accounts WHERE plan = 'pro')                AS pro_users,
        (SELECT count(*) FROM accounts WHERE status = 'suspended')        AS suspended,
        (SELECT count(*) FROM accounts
          WHERE created_at > now() - interval '7 days')                   AS new_this_week,
        (SELECT count(*) FROM searches)                                   AS total_searches,
        (SELECT count(*) FROM searches
          WHERE searched_at > now() - interval '24 hours')                AS searches_today,
        (SELECT count(DISTINCT account_id) FROM searches
          WHERE searched_at > now() - interval '7 days')                  AS active_this_week
    `);
    const s = rows[0];
    res.json({
      total_users: Number(s.total_users),
      pro_users: Number(s.pro_users),
      suspended: Number(s.suspended),
      new_this_week: Number(s.new_this_week),
      total_searches: Number(s.total_searches),
      searches_today: Number(s.searches_today),
      active_this_week: Number(s.active_this_week),
    });
  } catch (err) {
    console.error("admin stats failed:", err.message);
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.get("/users", async (req, res) => {
  const q     = (req.query.q || "").toString().trim().slice(0, 100);
  const plan  = (req.query.plan || "").toString();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(a.email_lower LIKE $${params.length}
                 OR lower(a.cf_handle) LIKE $${params.length}
                 OR lower(coalesce(a.full_name,'')) LIKE $${params.length})`);
  }
  if (plan === "free" || plan === "pro") {
    params.push(plan);
    where.push(`a.plan = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT a.id, a.email, a.cf_handle, a.role, a.plan, a.status,
              a.full_name, a.country, a.created_at, a.last_login_at,
              (SELECT count(*) FROM searches s WHERE s.account_id = a.id) AS search_count,
              (SELECT max(s.searched_at) FROM searches s WHERE s.account_id = a.id) AS last_search_at
         FROM accounts a
         ${whereSql}
         ORDER BY a.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS n FROM accounts a ${whereSql}`,
      params.slice(0, params.length - 2)
    );
    res.json({
      users: rows.map(r => ({ ...r, search_count: Number(r.search_count) })),
      total: countRows[0].n,
    });
  } catch (err) {
    console.error("admin users failed:", err.message);
    res.status(500).json({ error: "Could not load users" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, cf_handle, role, plan, status, full_name, phone,
              country, institution, bio, created_at, updated_at, last_login_at
         FROM accounts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const { rows: searches } = await query(
      `SELECT id, cf_handle, searched_at, ok, duration_ms, cf_rating, weakest_tag, error
         FROM searches WHERE account_id = $1
         ORDER BY searched_at DESC LIMIT 50`, [req.params.id]);

    const { rows: sessions } = await query(
      `SELECT created_at, expires_at, user_agent, ip
         FROM sessions WHERE account_id = $1
         ORDER BY created_at DESC LIMIT 10`, [req.params.id]);

    res.json({ user: rows[0], searches, sessions });
  } catch (err) {
    console.error("admin user detail failed:", err.message);
    res.status(500).json({ error: "Could not load the user" });
  }
});

const adminEditSchema = z.object({
  email:       z.string().trim().email().max(254).optional(),
  cf_handle:   z.string().trim().min(1).max(48)
                .regex(/^[A-Za-z0-9_.-]+$/).optional(),
  full_name:   z.string().trim().max(120).optional().nullable(),
  phone:       z.string().trim().max(40).optional().nullable(),
  country:     z.string().trim().max(80).optional().nullable(),
  institution: z.string().trim().max(120).optional().nullable(),
  bio:         z.string().trim().max(600).optional().nullable(),
  role:        z.enum(["user", "admin"]).optional(),
  plan:        z.enum(["free", "pro"]).optional(),
  status:      z.enum(["active", "suspended"]).optional(),
  password:    z.string().min(8).max(200).optional(),
});

router.patch("/users/:id", async (req, res) => {
  const parsed = adminEditSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const fields = { ...parsed.data };
  const id = req.params.id;

  // An admin must not be able to lock everyone out by demoting or suspending
  // the last remaining admin.
  if (fields.role === "user" || fields.status === "suspended") {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM accounts
        WHERE role = 'admin' AND status = 'active' AND id <> $1`, [id]);
    const target = await query(`SELECT role FROM accounts WHERE id = $1`, [id]);
    if (target.rows[0]?.role === "admin" && rows[0].n === 0) {
      return res.status(400).json({
        error: "This is the last active admin. Promote another account first.",
      });
    }
  }

  const updates = {};
  if (fields.password) {
    updates.password_hash = await hashPassword(fields.password);
    delete fields.password;
  }
  if (fields.email) {
    const emailLower = fields.email.toLowerCase();
    const clash = await query(
      `SELECT 1 FROM accounts WHERE email_lower = $1 AND id <> $2`,
      [emailLower, id]);
    if (clash.rowCount) {
      return res.status(409).json({ error: "Another account uses that email" });
    }
    updates.email = fields.email;
    updates.email_lower = emailLower;
    delete fields.email;
  }
  Object.assign(updates, fields);

  const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: "Nothing to update" });

  try {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = keys.map(k => (updates[k] === "" ? null : updates[k]));
    const { rows } = await query(
      `UPDATE accounts SET ${sets}, updated_at = now()
        WHERE id = $1
        RETURNING id, email, cf_handle, role, plan, status, full_name,
                  phone, country, institution, bio, created_at, last_login_at`,
      [id, ...values]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    // Suspension must take effect immediately, not when the cookie expires.
    if (updates.status === "suspended" || updates.password_hash) {
      await query(`DELETE FROM sessions WHERE account_id = $1`, [id]);
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error("admin edit failed:", err.message);
    res.status(500).json({ error: "Could not save the changes" });
  }
});

router.delete("/users/:id", async (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account here" });
  }
  try {
    const { rows } = await query(`SELECT role FROM accounts WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    if (rows[0].role === "admin") {
      const { rows: others } = await query(
        `SELECT count(*)::int AS n FROM accounts
          WHERE role = 'admin' AND id <> $1`, [id]);
      if (others[0].n === 0) {
        return res.status(400).json({ error: "Cannot delete the last admin" });
      }
    }
    // sessions and searches cascade via ON DELETE CASCADE.
    await query(`DELETE FROM accounts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("admin delete failed:", err.message);
    res.status(500).json({ error: "Could not delete the account" });
  }
});

router.get("/searches", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  try {
    const { rows } = await query(
      `SELECT s.id, s.cf_handle, s.searched_at, s.ok, s.duration_ms,
              s.cf_rating, s.weakest_tag, s.error,
              a.email, a.id AS account_id
         FROM searches s
         LEFT JOIN accounts a ON a.id = s.account_id
        ORDER BY s.searched_at DESC
        LIMIT $1`, [limit]);
    res.json({ searches: rows });
  } catch (err) {
    console.error("admin searches failed:", err.message);
    res.status(500).json({ error: "Could not load searches" });
  }
});

export default router;

/* ── Discount codes ──────────────────────────────────────────────────────── */

const discountSchema = z.object({
  code: z.string().trim().min(3).max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphen or underscore only"),
  percent_off: z.coerce.number().int().min(1).max(100),
  max_uses: z.coerce.number().int().min(1).max(1000000),
  expires_at: z.string().min(1),
  note: z.string().trim().max(200).optional().nullable(),
  // Which plans the code is valid on. Omitted or empty means all plans.
  applies_to: z.array(z.enum(["monthly", "quarterly", "biannual"]))
    .optional().nullable(),
});

router.get("/discounts", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT d.*, a.email AS created_by_email,
             (d.active
               AND d.expires_at > now()
               AND d.used_count < d.max_uses) AS redeemable
        FROM discount_codes d
        LEFT JOIN accounts a ON a.id = d.created_by
       ORDER BY d.created_at DESC
       LIMIT 200`);
    res.json({ discounts: rows });
  } catch (err) {
    console.error("list discounts failed:", err.message);
    res.status(500).json({ error: "Could not load discount codes." });
  }
});

router.post("/discounts", async (req, res) => {
  const parsed = discountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { code, percent_off, max_uses, expires_at, note } = parsed.data;
  const appliesTo = parsed.data.applies_to?.length ? parsed.data.applies_to : null;

  const expiry = new Date(expires_at);
  if (Number.isNaN(expiry.getTime())) {
    return res.status(400).json({ error: "That expiry date is not valid." });
  }
  if (expiry.getTime() <= Date.now()) {
    return res.status(400).json({ error: "The expiry date must be in the future." });
  }

  try {
    const { rows } = await query(
      `INSERT INTO discount_codes
         (code, code_upper, percent_off, max_uses, expires_at, note,
          created_by, applies_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [code, code.toUpperCase(), percent_off, max_uses, expiry.toISOString(),
       note || null, req.user.id, appliesTo]);
    res.status(201).json({ discount: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "That code already exists." });
    }
    console.error("create discount failed:", err.message);
    res.status(500).json({ error: "Could not create that code." });
  }
});

// Deactivating keeps the row and its redemption history; deleting a code that
// people have already claimed would erase what they were given.
router.patch("/discounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const active = Boolean(req.body?.active);
  try {
    const { rows } = await query(
      `UPDATE discount_codes SET active = $2 WHERE id = $1 RETURNING *`,
      [id, active]);
    if (!rows.length) return res.status(404).json({ error: "Code not found" });
    res.json({ discount: rows[0] });
  } catch (err) {
    console.error("update discount failed:", err.message);
    res.status(500).json({ error: "Could not update that code." });
  }
});

router.delete("/discounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  try {
    const { rows } = await query(
      `SELECT used_count FROM discount_codes WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Code not found" });
    if (rows[0].used_count > 0) {
      return res.status(409).json({
        error: "This code has already been redeemed. Deactivate it instead, "
             + "so the people who claimed it keep their discount.",
      });
    }
    await query(`DELETE FROM discount_codes WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("delete discount failed:", err.message);
    res.status(500).json({ error: "Could not delete that code." });
  }
});

/* ── AI Coach settings ───────────────────────────────────────────────────── */

const COACH_MODEL_CHOICES = {
  "claude-opus-5":   { label: "Opus 5",   note: "Most capable. Around 2¢ per plan." },
  "claude-sonnet-5": { label: "Sonnet 5", note: "Cheaper and faster. Around 1¢ per plan." },
};

router.get("/coach", async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT value, updated_at FROM app_settings WHERE key = 'coach_model'`);
    const stored = rows[0]?.value;
    const model = COACH_MODEL_CHOICES[stored] ? stored : "claude-opus-5";
    const { rows: usage } = await query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE used_at > now() - interval '30 days')::int AS last_30d
        FROM coach_uses`);
    res.json({
      model,
      updated_at: rows[0]?.updated_at ?? null,
      // The key lives in the environment; we report only whether it is set.
      key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
      choices: Object.entries(COACH_MODEL_CHOICES)
        .map(([id, m]) => ({ id, ...m })),
      plans_generated: usage[0].total,
      plans_last_30d: usage[0].last_30d,
      free_trial_plans: 2,
    });
  } catch (err) {
    console.error("coach settings failed:", err.message);
    res.status(500).json({ error: "Could not load AI Coach settings." });
  }
});

router.put("/coach", async (req, res) => {
  const model = String(req.body?.model || "");
  if (!COACH_MODEL_CHOICES[model]) {
    return res.status(400).json({ error: "Unknown model." });
  }
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('coach_model', $1::jsonb, $2, now())
       ON CONFLICT (key) DO UPDATE
         SET value = $1::jsonb, updated_by = $2, updated_at = now()`,
      [JSON.stringify(model), req.user.id]);
    res.json({ model });
  } catch (err) {
    console.error("coach model update failed:", err.message);
    res.status(500).json({ error: "Could not save that." });
  }
});

/* ── InstaPay payments ───────────────────────────────────────────────────── */

router.get("/payments", async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status)
    ? req.query.status : "pending";
  try {
    const { rows } = await query(
      `SELECT p.id, p.plan_key, p.months, p.amount, p.currency, p.status,
              p.instapay_reference, p.extracted, p.checks, p.auto_verdict,
              p.reasons, p.created_at, p.reviewed_at, p.review_note,
              a.email, a.cf_handle, a.plus_expires_at
         FROM payments p
         JOIN accounts a ON a.id = p.account_id
        WHERE p.status = $1
        ORDER BY p.created_at DESC
        LIMIT 100`, [status]);
    const { rows: counts } = await query(
      `SELECT status, count(*)::int AS n FROM payments GROUP BY status`);
    const { rows: revenue } = await query(
      `SELECT coalesce(sum(amount),0)::numeric AS total,
              coalesce(sum(amount) FILTER (
                WHERE created_at > now() - interval '30 days'),0)::numeric AS last_30d
         FROM payments WHERE status = 'approved'`);
    res.json({
      payments: rows,
      counts: Object.fromEntries(counts.map(c => [c.status, c.n])),
      revenue: {
        total: Number(revenue[0].total),
        last_30d: Number(revenue[0].last_30d),
      },
    });
  } catch (err) {
    console.error("list payments failed:", err.message);
    res.status(500).json({ error: "Could not load payments." });
  }
});

// Registered BEFORE /payments/:id/:action below: Express takes the first
// matching route, and the wildcard would otherwise swallow "refund" and
// answer "Unknown action".
/** Whether a payment qualifies for a refund, and the facts behind the answer. */
router.get("/payments/:id/refund", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Not a valid payment id." });
  }
  try {
    const verdict = await refundEligibility(query, id);
    if (!verdict.found) return res.status(404).json({ error: "Payment not found." });
    res.json(verdict);
  } catch (err) {
    console.error("refund check failed:", err.message);
    res.status(500).json({ error: "Could not check that payment." });
  }
});

/** Record a refund that has been sent, and take back the term it paid for. */
router.post("/payments/:id/refund", async (req, res) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note || "").slice(0, 500) || null;
  // An admin may refund outside the policy -- a goodwill case, a mistake on
  // our side -- but has to say so explicitly rather than by omission.
  const override = Boolean(req.body?.override);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Not a valid payment id." });
  }
  try {
    const verdict = await refundEligibility(query, id);
    if (!verdict.found) return res.status(404).json({ error: "Payment not found." });
    if (verdict.refundable === false && !override) {
      return res.status(409).json({
        error: "This payment does not qualify under the refund policy.",
        code: verdict.reason,
        verdict,
      });
    }

    const { rows } = await query(
      `UPDATE payments
          SET refunded_at = now(), refunded_by = $2, refund_note = $3,
              refund_amount = amount, status = 'refunded'
        WHERE id = $1 AND refunded_at IS NULL
        RETURNING account_id, months, amount, currency`,
      [id, req.user.id, note]);
    if (!rows.length) {
      return res.status(409).json({ error: "That payment was already refunded." });
    }

    // Take back the time the payment bought. GREATEST keeps the result from
    // going negative if the term has already been partly consumed by other
    // payments.
    await query(
      `UPDATE accounts
          SET plus_expires_at = GREATEST(now(),
                COALESCE(plus_expires_at, now()) - ($2 || ' months')::interval),
              plan = CASE
                WHEN COALESCE(plus_expires_at, now())
                     - ($2 || ' months')::interval <= now()
                THEN 'free' ELSE plan END
        WHERE id = $1`,
      [rows[0].account_id, String(rows[0].months)]);

    res.json({
      ok: true,
      refunded: Number(rows[0].amount),
      currency: rows[0].currency,
      months_reversed: rows[0].months,
      outside_policy: override && verdict.refundable === false,
    });
  } catch (err) {
    console.error("refund failed:", err.message);
    res.status(500).json({ error: "Could not record that refund." });
  }
});

router.post("/payments/:id/:action", async (req, res) => {
  const id = Number(req.params.id);
  const action = req.params.action;
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Unknown action" });
  }
  const note = String(req.body?.note || "").slice(0, 400) || null;

  try {
    // Only a pending payment can be decided, so a double click cannot grant
    // two terms for one transfer.
    const { rows } = await query(
      `UPDATE payments
          SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
        WHERE id = $1 AND status = 'pending'
        RETURNING account_id, months`,
      [id, action === "approve" ? "approved" : "rejected", req.user.id, note]);

    if (!rows.length) {
      return res.status(409).json({ error: "That payment was already reviewed." });
    }

    if (action === "approve") {
      const { grantPlus } = await import("./payments.js");
      await grantPlus(rows[0].account_id, rows[0].months);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("review payment failed:", err.message);
    res.status(500).json({ error: "Could not record that decision." });
  }
});

/* ── AI Coach completion ─────────────────────────────────────────────────────
 * Whether people actually follow the plans, which is the signal for tuning
 * how the coach writes them. A plan nobody finishes past day 3 is telling you
 * days 4-7 are too ambitious, not that the students are lazy.
 */
router.get("/coach/stats", async (_req, res) => {
  try {
    // Headline: plans generated, how many were started, and the share of all
    // planned days actually ticked off.
    const { rows: [overall] } = await query(`
      SELECT
        count(*)::int                                        AS plans,
        count(*) FILTER (WHERE p.done > 0)::int              AS started,
        count(*) FILTER (WHERE p.done >= s.coach_day_count)::int AS finished,
        COALESCE(sum(p.done), 0)::int                        AS days_done,
        COALESCE(sum(s.coach_day_count), 0)::int             AS days_total
      FROM searches s
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS done FROM coach_day_progress g
         WHERE g.search_id = s.id
      ) p ON true
      WHERE s.coach_plan IS NOT NULL`);

    // Drop-off: of the plans that reach each day, how many tick it. This is
    // the most actionable view -- it shows exactly where people stop.
    const { rows: byDay } = await query(`
      SELECT d.day_number,
             count(g.*)::int AS completed,
             (SELECT count(*)::int FROM searches s
               WHERE s.coach_plan IS NOT NULL
                 AND COALESCE(s.coach_day_count, 7) >= d.day_number) AS eligible
        FROM generate_series(1, 7) AS d(day_number)
        LEFT JOIN coach_day_progress g ON g.day_number = d.day_number
       GROUP BY d.day_number
       ORDER BY d.day_number`);

    // By topic: which subjects get finished and which get skipped.
    const { rows: byTopic } = await query(`
      SELECT topic, count(*)::int AS completed
        FROM coach_day_progress
       WHERE topic IS NOT NULL AND topic <> ''
       GROUP BY topic
       ORDER BY completed DESC
       LIMIT 20`);

    // Per user, most recently active first.
    const { rows: users } = await query(`
      SELECT a.email, a.cf_handle, s.id AS run_id,
             s.coach_written_at,
             COALESCE(s.coach_day_count, 7)             AS day_count,
             count(g.*)::int                            AS days_done,
             max(g.completed_at)                        AS last_activity,
             (a.pinned_search_id = s.id)                AS pinned
        FROM searches s
        JOIN accounts a ON a.id = s.account_id
        LEFT JOIN coach_day_progress g ON g.search_id = s.id
       WHERE s.coach_plan IS NOT NULL
       GROUP BY a.email, a.cf_handle, s.id, s.coach_written_at,
                s.coach_day_count, a.pinned_search_id
       ORDER BY max(g.completed_at) DESC NULLS LAST, s.coach_written_at DESC
       LIMIT 100`);

    res.json({
      overall: {
        ...overall,
        completion_percent: overall.days_total
          ? Math.round((overall.days_done / overall.days_total) * 100) : 0,
        start_rate: overall.plans
          ? Math.round((overall.started / overall.plans) * 100) : 0,
      },
      by_day: byDay,
      by_topic: byTopic,
      users: users.map(u => ({
        ...u,
        percent: u.day_count
          ? Math.round((u.days_done / u.day_count) * 100) : 0,
      })),
    });
  } catch (err) {
    console.error("coach stats failed:", err.message);
    res.status(500).json({ error: "Could not load coach stats." });
  }
});

/** The stored receipt for one payment, for reviewing or resolving a dispute.
 *
 *  Served as an image rather than embedded in JSON: it is only fetched when an
 *  admin opens a specific payment, so it never rides along with the list. */
router.get("/payments/:id/receipt", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Not a valid payment id." });
  }
  try {
    const { rows } = await query(
      `SELECT screenshot_data, screenshot_mime, screenshot_kept_until
         FROM payments WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Payment not found." });
    if (!rows[0].screenshot_data) {
      // Either past its retention date or submitted before receipts were kept.
      return res.status(410).json({
        error: "No receipt is stored for this payment.",
        code: "RECEIPT_GONE",
      });
    }
    res.set("Content-Type", rows[0].screenshot_mime || "image/jpeg");
    // Never cached by a shared proxy: this is someone's banking screenshot.
    res.set("Cache-Control", "private, no-store");
    res.send(rows[0].screenshot_data);
  } catch (err) {
    console.error("receipt fetch failed:", err.message);
    res.status(500).json({ error: "Could not load that receipt." });
  }
});
