// Where people reach a human.
//
// Payment disputes must not go to the public discussion channel: a refund
// request carries a transaction reference and an amount, and that thread is
// readable by anyone. Support gets its own address on the domain we already
// own, so it survives any change of personal email and reads as a business
// rather than an individual.

export const SUPPORT_EMAIL = "support@digisolution.app";

/** Prefilled mailto, so someone reporting a payment problem is prompted for
 *  the one detail that makes it resolvable. */
export function supportMailto(subject = "", body = "") {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (body) q.set("body", body);
  const qs = q.toString();
  return `mailto:${SUPPORT_EMAIL}${qs ? `?${qs}` : ""}`;
}

export const REFUND_MAILTO = supportMailto(
  "Refund request",
  "Transaction reference:\n\nAccount email:\n\nReason (optional):\n",
);

export const PAYMENT_ISSUE_MAILTO = supportMailto(
  "Payment problem",
  "Transaction reference:\n\nWhat happened:\n",
);
