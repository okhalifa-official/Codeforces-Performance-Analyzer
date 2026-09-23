// Refund eligibility.
//
// The policy: a payment can be refunded within 14 days of approval, provided
// the account has not run an analysis or generated a coaching plan since it
// was approved. Beyond that window, or once the service has been used, the
// term stands.
//
// This lives in one place so the answer an admin sees is the same rule the
// terms state. Eligibility is computed, never stored: it changes with the
// clock and with what the account does.

export const COOLING_OFF_DAYS = 14;

/**
 * Can this payment be refunded under the cooling-off policy?
 *
 * Returns a verdict plus the facts behind it, so an admin reviewing a request
 * sees WHY rather than a bare yes/no -- and can make an exception knowing
 * exactly what they are overriding.
 */
export async function refundEligibility(query, paymentId) {
  const { rows } = await query(
    `SELECT id, account_id, status, amount, currency, months, created_at,
            reviewed_at
       FROM payments WHERE id = $1`, [paymentId]);
  if (!rows.length) return { found: false };

  const p = rows[0];
  // The term starts when the payment is approved, not when it was submitted:
  // a payment sitting in review for three days should not eat the window.
  const startedAt = p.reviewed_at || p.created_at;
  const deadline = new Date(new Date(startedAt).getTime()
    + COOLING_OFF_DAYS * 24 * 60 * 60 * 1000);
  const withinWindow = Date.now() <= deadline.getTime();

  // Usage since approval. Both tables are checked because either one means
  // the Plus term was consumed.
  const { rows: [use] } = await query(
    `SELECT
       (SELECT count(*)::int FROM searches
         WHERE account_id = $1 AND searched_at > $2) AS analyses,
       (SELECT count(*)::int FROM coach_uses
         WHERE account_id = $1 AND used_at > $2) AS plans`,
    [p.account_id, startedAt]);

  const used = (use.analyses + use.plans) > 0;
  const refundable = p.status === "approved"
    && Number(p.amount) > 0
    && withinWindow
    && !used;

  return {
    found: true,
    refundable,
    reason: p.status !== "approved" ? "NOT_APPROVED"
          : Number(p.amount) <= 0   ? "NOTHING_PAID"
          : !withinWindow           ? "WINDOW_PASSED"
          : used                    ? "SERVICE_USED"
          : null,
    amount: Number(p.amount),
    currency: p.currency,
    started_at: startedAt,
    deadline: deadline.toISOString(),
    days_left: Math.max(0,
      Math.ceil((deadline.getTime() - Date.now()) / 86_400_000)),
    analyses_since: use.analyses,
    plans_since: use.plans,
  };
}
