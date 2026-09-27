import { T } from "../lib/theme.js";
import { Card } from "../components/ui.jsx";
import { FEEDBACK_URL } from "../components/Footer.jsx";
import { SUPPORT_EMAIL } from "../lib/contact.js";

// Kept in step with TERMS_VERSION in server/routes/auth.js, which is what each
// account records at sign-up.
const VERSION = "2026-09-27";

const SECTIONS = [
  {
    h: "Who we are",
    p: [
      "CFAnalyzer is operated by Omar Khalifa, an individual based in Egypt.",
      `Contact: ${SUPPORT_EMAIL}.`,
    ],
  },
  {
    h: "What this service is",
    p: [
      "CFAnalyzer reads publicly available Codeforces data through the official Codeforces API and produces an assessment of your strengths, weaknesses and suggested practice problems.",
      "It is an independent project. It is not built, endorsed or sponsored by Codeforces or its developers, and it is not affiliated with them in any way.",
    ],
  },
  {
    h: "Your account",
    p: [
      "You need a working email address, which we ask you to confirm with a code before the analyzer can be used. Each person may hold one account.",
      "Your email address is fixed once the account exists. If you need it changed, contact us on the discussion channel and we will do it for you.",
      "Your Codeforces handle may be changed once every six months. Analysing a handle other than your own is limited: once every three months on the free tier, once a week on Plus.",
      "Analysing your own handle is limited too: once a week on the free tier, three times a week on Plus, with at least 24 hours between analyses.",
      "An AI coaching plan is available on Plus only, and each analysis can produce at most one plan.",
      "You are responsible for keeping your password to yourself and for what happens under your account.",
      "You must be at least 13 years old to create an account. To buy Plus you must be 18 or older, or have permission from a parent or guardian who agrees to these terms on your behalf.",
    ],
  },
  {
    h: "Plus subscriptions and payment",
    p: [
      "Plus is sold in fixed terms of one, three or six months. Payment is by InstaPay transfer, confirmed by uploading the receipt and entering its reference number.",
      "An approved payment adds its term to any time you already have. Terms do not renew automatically and nothing is charged to you without you sending a transfer.",
      "One transfer may be submitted per day, and each transaction reference may be used once.",
      `Payments are checked automatically first. Any payment the automatic check does not approve is reviewed by a person before it is finally refused, and you can ask for that human review by emailing ${SUPPORT_EMAIL} with the transaction reference.`,
    ],
  },
  {
    h: "Refunds and cancellation",
    p: [
      "You can ask for a full refund within 14 days of a payment being approved, provided you have not run an analysis or generated a coaching plan since then. Once the service has been used, or once 14 days have passed, the term stands.",
      `To request one, email ${SUPPORT_EMAIL} with the transaction reference. We will check it and, if it qualifies, send the money back by InstaPay within 14 days of your request.`,
      "Terms do not renew and nothing recurs, so there is no subscription to cancel. If you simply stop paying, your Plus term runs to its end date and the account returns to the free tier.",
      "If we discontinue the service, or suspend your account for a reason that is not your doing, we will refund the unused part of your term pro-rata. We will not refund time remaining on an account suspended for submitting payment receipts that are not yours or for deliberately bypassing the limits set out here.",
      "Refunds are returned to the account that sent the transfer. We cannot send a refund to a different account.",
    ],
  },
  {
    h: "What we cannot promise",
    p: [
      "The analysis is a model's estimate, not advice and not a prediction. Ratings, recommended problems and coaching plans may be wrong, and acting on them is your decision.",
      "The service depends on the Codeforces API and on our own infrastructure. It may be unavailable, and results may change as the model is retrained.",
      "To the extent the law allows, our total liability to you for anything related to the service is limited to the amount you paid us in the 12 months before the claim.",
      "Nothing in these terms limits rights you have under Egyptian consumer protection law that cannot be excluded.",
    ],
  },
  {
    h: "Your data",
    p: [
      "We store your email address, your Codeforces handle, your analyses and your payment records. Submitted payment screenshots are kept so payments can be reviewed and disputed.",
      "From each receipt we read the amount, currency, transaction reference, date and time, and the sender's and recipient's InstaPay addresses, phone numbers or account numbers as shown on the receipt.",
      "Receipt images are kept for 24 months and then deleted. The payment record itself — reference, amount and date — is kept afterwards for accounting.",
      "We do not sell your data. Payment screenshots are sent to Anthropic, the AI provider, to read the receipt, and emails are sent through Resend. Neither is used to sell your data.",
      "Analyses are visible to you and to administrators of this service.",
      `You can ask us to delete your account by emailing ${SUPPORT_EMAIL}. We will do so within 30 days. Payment records — reference, amount and date — are kept as long as required for accounting even after deletion.`,
    ],
  },
  {
    h: "Acceptable use",
    p: [
      "Do not attempt to bypass the limits described here, submit payment receipts that are not yours, or use the service to place load on Codeforces.",
      "Accounts that do may be suspended.",
    ],
  },
  {
    h: "Contacting us",
    p: [
      `Anything about a payment — a refund, a rejected transfer, a receipt we could not read — goes to ${SUPPORT_EMAIL}. Please include the transaction reference. Do not post payment details on the public discussion channel.`,
      "Bugs, feature requests and general questions are best raised on the discussion channel, linked at the bottom of every page.",
      "We aim to answer within a few days.",
    ],
  },
  {
    h: "Governing law",
    p: [
      "These terms are governed by the laws of the Arab Republic of Egypt, and any dispute will be heard by the competent courts of Cairo.",
      `Before going to court, please contact us at ${SUPPORT_EMAIL} so we can try to resolve it.`,
    ],
  },
  {
    h: "Changes",
    p: [
      "These terms may change. The version you agreed to is recorded against your account, and material changes will be announced on the discussion channel.",
    ],
  },
];

export default function Terms() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 22px 20px" }}>
      <h1 style={{ fontSize: 30, fontWeight: 780, margin: "0 0 8px",
                   letterSpacing: -0.8 }}>
        Terms and Conditions
      </h1>
      <p style={{ color: T.textFaint, fontSize: 13, margin: "0 0 30px" }}>
        Version {VERSION}. Creating an account means accepting these terms.
      </p>

      <Card style={{ padding: 28 }}>
        {SECTIONS.map((s, i) => (
          <section key={s.h} style={{ marginBottom: i === SECTIONS.length - 1 ? 0 : 26 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>
              {s.h}
            </h2>
            {s.p.map((line) => (
              <p key={line} style={{ margin: "0 0 10px", fontSize: 14,
                                     color: T.textDim, lineHeight: 1.7 }}>
                {line}
              </p>
            ))}
          </section>
        ))}
      </Card>

      <p style={{ fontSize: 13, color: T.textFaint, lineHeight: 1.7,
                  margin: "22px 0 0" }}>
        Questions about any of this?{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer"
           style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
          Ask on the discussion channel
        </a>.
      </p>
    </div>
  );
}
