// Transactional email. Resend is the provider; the rest of the app only sees
// sendVerificationCode / sendPasswordReset / sendBetaWaitlistNotice, so
// swapping providers is one file.
//
// Nothing here throws on a send failure. A caller that cannot email a code
// still has to decide what to tell the user, and an exception mid-signup
// would leave an account created but unreachable.

import { Resend } from "resend";
import { betaMaxAccounts } from "./beta.js";

// Must be an address on a domain verified in Resend (mail.digisolution.app).
// Resend's shared onboarding@resend.dev sender fails alignment and lands in spam.
const FROM = process.env.MAIL_FROM || "CFAnalyzer <no-reply@mail.digisolution.app>";
const APP_NAME = "CFAnalyzer";

// Where reset links point. In production this must be the real origin, or the
// link in the email will 404.
export function appOrigin() {
  return (process.env.APP_ORIGIN || "https://cf-performance-analyzer.up.railway.app")
    .replace(/\/+$/, "");
}

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

let _client = null;
function client() {
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

/** Send one email. Returns {ok, error} — never throws. */
async function send({ to, subject, html, text }) {
  if (!mailConfigured()) {
    return { ok: false, error: "MAIL_NOT_CONFIGURED" };
  }
  try {
    // The Resend SDK reports failures in an `error` field rather than by
    // throwing, so both paths have to be handled.
    const { data, error } = await client().emails.send({
      from: FROM, to: [to], subject, html, text,
    });
    if (error) {
      console.error("mail send failed:", error.name || "", error.message || error);
      return { ok: false, error: error.message || "send failed" };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("mail threw:", err.message);
    return { ok: false, error: err.message };
  }
}

/* ── templates ───────────────────────────────────────────────────────────── */

// Inline styles only: email clients strip <style> blocks, and a dark theme
// cannot be assumed, so the mail is designed light and readable either way.
function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border-radius:12px;
                    border:1px solid #e4e6eb;padding:32px;font-family:
                    -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding-right:12px;">
                <img src="${appOrigin()}/email-logo.png" width="40" height="40"
                     alt="" style="display:block;border:0;border-radius:9px;">
              </td>
              <td style="font-size:15px;font-weight:700;color:#1a1d24;">${APP_NAME}</td>
            </tr>
          </table>
          <h1 style="font-size:19px;font-weight:700;color:#1a1d24;margin:0 0 14px;">
            ${title}
          </h1>
          ${bodyHtml}
          <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e4e6eb;
                      font-size:12px;color:#8b90a0;line-height:1.6;">
            An independent project, not affiliated with Codeforces.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

export async function sendVerificationCode(to, code) {
  return send({
    to,
    subject: `${code} is your ${APP_NAME} verification code`,
    html: shell("Confirm your email", `
      <p style="font-size:14px;color:#454a56;line-height:1.65;margin:0 0 20px;">
        Enter this code to finish creating your account. It expires in 15 minutes.
      </p>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                  font-size:30px;font-weight:700;letter-spacing:7px;color:#1a1d24;
                  background:#f4f5f7;border-radius:10px;padding:16px;text-align:center;">
        ${code}
      </div>
      <p style="font-size:13px;color:#8b90a0;line-height:1.65;margin:20px 0 0;">
        If you did not sign up, you can ignore this email.
      </p>`),
    text: `Your ${APP_NAME} verification code is ${code}. It expires in 15 minutes.`,
  });
}

export async function sendPasswordReset(to, token) {
  const link = `${appOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  return send({
    to,
    subject: `Reset your ${APP_NAME} password`,
    html: shell("Reset your password", `
      <p style="font-size:14px;color:#454a56;line-height:1.65;margin:0 0 22px;">
        Click below to choose a new password. The link works once and expires
        in 60 minutes.
      </p>
      <a href="${link}" style="display:inline-block;background:#5b6cff;color:#ffffff;
         text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;
         border-radius:9px;">Choose a new password</a>
      <p style="font-size:12px;color:#8b90a0;line-height:1.65;margin:22px 0 0;
                word-break:break-all;">
        Or paste this into your browser:<br>${link}
      </p>
      <p style="font-size:13px;color:#8b90a0;line-height:1.65;margin:18px 0 0;">
        If you did not ask for this, ignore this email — your password will not
        change.
      </p>`),
    text: `Reset your ${APP_NAME} password: ${link}\nThe link works once and expires in 60 minutes.`,
  });
}

/** Sent when a sign-up lands past the closed-beta cap: the account exists but
 *  cannot be used yet. */
export async function sendBetaWaitlistNotice(to) {
  const max = betaMaxAccounts();
  return send({
    to,
    subject: `Your ${APP_NAME} account is on the waitlist`,
    html: shell("You're on the waitlist", `
      <p style="font-size:14px;color:#454a56;line-height:1.65;margin:0 0 16px;">
        Your account was created successfully. ${APP_NAME} is currently in a
        limited beta open to the first ${max} accounts, and yours came in after
        that limit.
      </p>
      <p style="font-size:14px;color:#454a56;line-height:1.65;margin:0;">
        There is nothing more you need to do. We will email you at this address
        as soon as the system is released.
      </p>`),
    text: `Your ${APP_NAME} account was created successfully. ${APP_NAME} is currently in a limited beta open to the first ${max} accounts, and yours came in after that limit. We will email you at this address as soon as the system is released.`,
  });
}
