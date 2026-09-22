// InstaPay checkout: submit a transfer receipt, get Plus.
//
// InstaPay has no recurring billing, so Plus is sold as fixed-length passes.
// Each approved payment adds its term to plus_expires_at rather than starting
// a subscription that renews itself.
import express from "express";
import { query } from "../db/pool.js";
import {
  verifyInstapayScreenshot, decodeBase64Image, PLANS, priceFor,
  normalizeReference,
} from "../services/instapayVerification.js";
import {
  lookupPromo, consumePromo, PROMO_MESSAGES, discountAppliesTo,
} from "../services/promos.js";
import { prepareReceipt, RECEIPT_RETENTION_MONTHS } from "../services/receipts.js";

const router = express.Router();

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const CURRENCY = String(process.env.INSTAPAY_CURRENCY || "EGP").toUpperCase();
const HANDLE = String(process.env.INSTAPAY_HANDLE || "").trim();

function requireUser(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to upgrade" });
    return false;
  }
  return true;
}

/** What the checkout page needs: plans, where to send, and current status. */
router.get("/config", async (req, res) => {
  res.json({
    configured: Boolean(HANDLE),
    handle: HANDLE || null,
    currency: CURRENCY,
    // No discount is applied here any more. A promo is entered during
    // checkout and previewed through /promo, so the price shown is always the
    // result of a code this person just typed.
    discount: null,
    plans: Object.values(PLANS).map(p => {
      const listPrice = PLANS.monthly.price * p.months;
      return {
        ...p,
        price_after_discount: p.price,
        per_month: Math.round(p.price / p.months),
        discounted: false,
        list_price: listPrice,
        saving: Math.max(0, listPrice - p.price),
        saving_percent: listPrice > 0
          ? Math.round((1 - p.price / listPrice) * 100) : 0,
      };
    }),
  });
});

/** Preview a promo code against a plan. Consumes nothing. */
router.post("/promo", async (req, res) => {
  if (!requireUser(req, res)) return;

  const planKey = String(req.body?.plan || "");
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: "Choose a plan first." });

  const found = await lookupPromo(req.body?.code, req.user.id);
  if (!found.ok) {
    return res.status(400).json({
      error: PROMO_MESSAGES[found.reason] || "That code cannot be used.",
      code: found.reason,
    });
  }
  if (!discountAppliesTo(found, planKey)) {
    // Say which plans it does cover, so the answer is actionable.
    const names = (found.applies_to || [])
      .map(k => PLANS[k]?.label).filter(Boolean).join(", ");
    return res.status(400).json({
      error: names
        ? `That code only applies to: ${names}.`
        : PROMO_MESSAGES.NOT_FOR_PLAN,
      code: "NOT_FOR_PLAN",
      applies_to: found.applies_to,
    });
  }

  const price = priceFor(planKey, found.percent_off);
  res.json({
    ok: true,
    code: found.code,
    percent_off: found.percent_off,
    applies_to: found.applies_to,
    remaining: found.remaining,
    plan: planKey,
    original_price: plan.price,
    price: price,
    saving: plan.price - price,
    // At zero there is nothing to transfer, so checkout skips InstaPay.
    free: price <= 0,
  });
});

/** Redeem a code that covers the whole price. No transfer, immediate access. */
router.post("/redeem-free", async (req, res) => {
  if (!requireUser(req, res)) return;

  if (req.user.email_verified === false) {
    return res.status(403).json({
      error: "Confirm your email address first.", code: "EMAIL_UNVERIFIED",
    });
  }

  const planKey = String(req.body?.plan || "");
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: "Choose a plan." });

  const found = await lookupPromo(req.body?.code, req.user.id);
  if (!found.ok) {
    return res.status(400).json({
      error: PROMO_MESSAGES[found.reason] || "That code cannot be used.",
      code: found.reason,
    });
  }
  if (!discountAppliesTo(found, planKey)) {
    return res.status(400).json({
      error: PROMO_MESSAGES.NOT_FOR_PLAN, code: "NOT_FOR_PLAN",
    });
  }

  // The price is recomputed from the code, never taken from the request: a
  // client claiming "this is free" must not be believed.
  const price = priceFor(planKey, found.percent_off);
  if (price > 0) {
    return res.status(400).json({
      error: "That code does not cover the whole price. Pay the rest by InstaPay.",
      code: "NOT_FREE",
      price,
    });
  }

  const spent = await consumePromo(found.id, req.user.id, found.percent_off);
  if (!spent.ok) {
    return res.status(409).json({
      error: PROMO_MESSAGES[spent.reason] || "That code could not be used.",
      code: spent.reason,
    });
  }

  try {
    // Recorded as an approved payment of 0 so a free grant appears in the
    // admin list and the user's history alongside every other purchase.
    const { rows } = await query(
      `INSERT INTO payments
         (account_id, plan_key, months, amount, currency, discount_code_id,
          percent_off, status, auto_verdict, reasons, reviewed_at)
       VALUES ($1,$2,$3,0,$4,$5,$6,'approved','promo',$7::jsonb, now())
       RETURNING id, created_at`,
      [req.user.id, planKey, plan.months, CURRENCY, found.id,
       found.percent_off,
       JSON.stringify([`Covered in full by promo code ${found.code}.`])]);

    await grantPlus(req.user.id, plan.months);

    res.json({
      status: "approved",
      free: true,
      payment_id: rows[0].id,
      months: plan.months,
      code: found.code,
    });
  } catch (err) {
    console.error("free redeem failed:", err.message);
    res.status(500).json({ error: "Could not grant access. Contact us." });
  }
});

/** Submit a transfer receipt. */
router.post("/instapay", async (req, res) => {
  if (!requireUser(req, res)) return;

  if (!HANDLE) {
    return res.status(503).json({
      error: "Payments are not configured yet.", code: "NOT_CONFIGURED",
    });
  }

  // Paying is the one place where reaching the account later really matters:
  // a receipt, a refund or a review all go to this address.
  if (req.user.email_verified === false) {
    return res.status(403).json({
      error: "Confirm your email address before paying, so we can reach you "
           + "about your payment.",
      code: "EMAIL_UNVERIFIED",
    });
  }

  const planKey = String(req.body?.plan || "");
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: "Choose a plan." });

  const image = decodeBase64Image(req.body?.screenshot);
  if (!image) {
    return res.status(400).json({ error: "Attach a screenshot of your transfer." });
  }
  const bytes = Math.floor((image.base64.length * 3) / 4);
  if (bytes > MAX_SCREENSHOT_BYTES) {
    return res.status(413).json({ error: "That image is too large. Keep it under 8 MB." });
  }

  // One pending submission at a time, so a user cannot queue ten screenshots.
  try {
    const { rows } = await query(
      `SELECT id FROM payments WHERE account_id = $1 AND status = 'pending'`,
      [req.user.id]);
    if (rows.length) {
      return res.status(409).json({
        error: "You already have a payment awaiting review.", code: "PENDING_EXISTS",
      });
    }
  } catch { /* fall through rather than block a genuine payment */ }

  // At most one transfer per account per day. The pending check above only
  // holds while a submission is unreviewed, so a rejection would otherwise
  // free the slot at once and let someone retry screenshots all day until one
  // slipped past verification. Rejected attempts count against the cap for
  // exactly that reason. Verification reads an image with a model, so each
  // attempt also costs money.
  //
  // A rolling 24h window, not a calendar day: "one per day" should not reset
  // at midnight and hand out two in ten minutes.
  try {
    const { rows } = await query(
      `SELECT created_at, status FROM payments
        WHERE account_id = $1 AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
    if (rows.length) {
      const nextAt = new Date(new Date(rows[0].created_at).getTime() + 86_400_000);
      const hours = Math.max(1, Math.ceil((nextAt - Date.now()) / 3_600_000));
      // Rejections count against the cap, so someone whose genuine transfer
      // was misread hits this. Telling them "one per day" and nothing else
      // would read as a refusal to look at it -- say what actually happens
      // to a rejected payment and how to reach a human.
      const wasRejected = rows[0].status === "rejected";
      return res.status(429).json({
        error: wasRejected
          ? `Your last transfer could not be verified automatically and is `
            + `waiting for manual review — you do not need to send another. `
            + `If you want it looked at sooner, report it and include the `
            + `transaction reference. You can submit again in ${hours} `
            + `hour${hours === 1 ? "" : "s"} if you need to.`
          : `You can only submit one transfer per day. Try again in `
            + `${hours} hour${hours === 1 ? "" : "s"}.`,
        code: "DAILY_LIMIT",
        previous_status: rows[0].status,
        next_at: nextAt.toISOString(),
      });
    }
  } catch { /* fall through rather than block a genuine payment */ }

  // The promo is re-read from the database and the price recomputed here.
  // Nothing about the discount is taken from the request: a client claiming
  // "90% off" must not be believed.
  //
  // The code is NOT consumed yet -- that happens once the payment is recorded,
  // so an abandoned or rejected checkout does not burn a limited use.
  let percentOff = 0, discountId = null, promo = null;
  if (req.body?.code) {
    const found = await lookupPromo(req.body.code, req.user.id);
    if (!found.ok) {
      return res.status(400).json({
        error: PROMO_MESSAGES[found.reason] || "That code cannot be used.",
        code: found.reason,
      });
    }
    // Scoped codes only reduce the plans they name. A user holding a 6-month
    // code cannot pay the discounted figure for a 1-month term.
    if (!discountAppliesTo(found, planKey)) {
      return res.status(400).json({
        error: PROMO_MESSAGES.NOT_FOR_PLAN, code: "NOT_FOR_PLAN",
      });
    }
    promo = found;
    percentOff = found.percent_off;
    discountId = found.id;
  }

  const expectedAmount = priceFor(planKey, percentOff);

  // A code covering the whole price has its own route: there is no transfer to
  // verify, and asking for a receipt of a 0 EGP payment makes no sense.
  if (expectedAmount <= 0) {
    return res.status(400).json({
      error: "That code covers the whole price. No transfer is needed.",
      code: "USE_FREE_REDEEM",
    });
  }

  // The payer types the reference from their own receipt. It is required:
  // matching it against the printed one is the check that a borrowed
  // screenshot cannot pass.
  const claimedReference = normalizeReference(req.body?.reference);
  if (!claimedReference) {
    return res.status(400).json({
      error: "Enter the reference number shown on your transfer receipt.",
      code: "REFERENCE_REQUIRED",
    });
  }
  if (claimedReference.length < 6 || claimedReference.length > 24) {
    return res.status(400).json({
      error: "That reference number does not look right. It is the long number "
           + "labelled \"Reference\" on your receipt.",
      code: "REFERENCE_INVALID",
    });
  }

  // Reject a replayed reference BEFORE the model call: reading the screenshot
  // costs money, and a reference already used is refused whatever it shows.
  try {
    const { rows } = await query(
      `SELECT id FROM payments
        WHERE instapay_reference = $1 AND status <> 'rejected'`,
      [claimedReference]);
    if (rows.length) {
      return res.status(409).json({
        status: "rejected",
        error: "This InstaPay transaction has already been used.",
        code: "DUPLICATE_REFERENCE",
        reasons: ["This InstaPay transaction has already been used."],
      });
    }
  } catch { /* the unique index is the real guard */ }

  let verification;
  try {
    verification = await verifyInstapayScreenshot({
      base64: image.base64,
      mimeType: image.mimeType,
      expectedAmount,
      expectedCurrency: CURRENCY,
      expectedRecipientHandle: HANDLE,
      claimedReference,
      screenshotBytes: bytes,
      uploadedAt: new Date(),
    });
  } catch (err) {
    console.error("instapay verification failed:", err.message);
    const code = err.code === "NO_KEY" ? 503 : 502;
    return res.status(code).json({
      error: err.code === "NO_KEY"
        ? "Payment verification is not configured yet."
        : "Could not check that screenshot. Try again in a moment.",
    });
  }

  // The typed reference is what the duplicate guard keys on: it was validated
  // against the screenshot above, and unlike the extracted one it is never
  // null. Storing the read value instead would leave a hole whenever
  // extraction missed the field.
  const ref = claimedReference;

  // Prepare the receipt before any branch returns: a rejection is exactly the
  // case someone disputes, so it needs the evidence too.
  const receipt = await prepareReceipt(image.base64, image.mimeType);

  if (verification.status === "rejected") {
    // Recorded rather than dropped. Without a row, "I paid and you refused
    // me" cannot be checked, and there is no way to see how often automatic
    // rejection fires or whether it is wrong.
    try {
      await query(
        `INSERT INTO payments
           (account_id, plan_key, months, amount, currency, status,
            instapay_reference, extracted, checks, auto_verdict, reasons,
            screenshot_mime, screenshot_bytes, screenshot_data,
            screenshot_kept_until, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,'rejected',$6,$7::jsonb,$8::jsonb,'rejected',
                 $9::jsonb,$10,$11,$12,
                 now() + ($13 || ' months')::interval, now())`,
        [req.user.id, planKey, plan.months, expectedAmount, CURRENCY, ref,
         JSON.stringify(verification.extracted),
         JSON.stringify(verification.checks),
         JSON.stringify(verification.reasons),
         receipt.mimeType, receipt.bytes, receipt.buffer,
         String(RECEIPT_RETENTION_MONTHS)]);
    } catch (err) {
      // A rejection that cannot be logged is still a rejection; the user must
      // hear the outcome either way.
      if (err.code !== "23505") {
        console.error("rejected payment log failed:", err.message);
      }
    }
    return res.json({
      status: "rejected",
      reasons: verification.reasons,
      checks: verification.checks,
    });
  }

  const approved = verification.status === "verified";

  try {
    const { rows } = await query(
      `INSERT INTO payments
         (account_id, plan_key, months, amount, currency, discount_code_id,
          percent_off, status, instapay_reference, extracted, checks,
          auto_verdict, reasons, screenshot_mime, screenshot_bytes,
          screenshot_data, screenshot_kept_until, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb,
               $14,$15,$16, now() + ($17 || ' months')::interval, $18)
       RETURNING id, status, created_at`,
      [req.user.id, planKey, plan.months, expectedAmount, CURRENCY, discountId,
       percentOff || null, approved ? "approved" : "pending", ref,
       JSON.stringify(verification.extracted), JSON.stringify(verification.checks),
       verification.status, JSON.stringify(verification.reasons),
       receipt.mimeType, receipt.bytes, receipt.buffer,
       String(RECEIPT_RETENTION_MONTHS), approved ? new Date() : null]);

    if (approved) {
      await grantPlus(req.user.id, plan.months);
    }

    res.json({
      status: approved ? "approved" : "pending",
      payment_id: rows[0].id,
      months: plan.months,
      checks: verification.checks,
      reasons: verification.reasons,
    });
  } catch (err) {
    if (err.code === "23505") {
      // Two unique indexes can raise this. Name them apart, or a user who hit
      // the daily cap would be told their transaction was already used --
      // which is false, and would send them chasing a refund.
      if (err.constraint === "idx_payments_one_per_day") {
        return res.status(429).json({
          error: "You can only submit one transfer per day. Try again tomorrow.",
          code: "DAILY_LIMIT",
        });
      }
      return res.json({
        status: "rejected",
        reasons: ["This InstaPay transaction has already been used."],
        checks: verification.checks,
      });
    }
    console.error("payment insert failed:", err.message);
    res.status(500).json({ error: "Could not record that payment." });
  }
});

/** Extend Plus by `months`, from now or from the existing expiry if later. */
export async function grantPlus(accountId, months) {
  await query(
    `UPDATE accounts
        SET plan = 'pro',
            plus_expires_at = GREATEST(COALESCE(plus_expires_at, now()), now())
                              + ($2 || ' months')::interval
      WHERE id = $1`, [accountId, String(months)]);
}

/** The signed-in user's own payments. */
router.get("/mine", async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    const { rows } = await query(
      `SELECT id, plan_key, months, amount, currency, status, created_at,
              reviewed_at, review_note, reasons
         FROM payments WHERE account_id = $1
        ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
    const { rows: acct } = await query(
      `SELECT plus_expires_at FROM accounts WHERE id = $1`, [req.user.id]);
    res.json({ payments: rows, plus_expires_at: acct[0]?.plus_expires_at ?? null });
  } catch (err) {
    console.error("payment history failed:", err.message);
    res.status(500).json({ error: "Could not load your payments." });
  }
});

export default router;
