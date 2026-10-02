// Thin fetch wrapper. Always sends cookies so the session travels with requests.

const BASE = import.meta.env.VITE_API_BASE || "";

// A waitlisted account is refused by every API route except auth. Whoever owns
// the session registers a callback here, so a stale tab or an old session
// re-reads the user and lands on the waitlist screen instead of showing
// errors on a page it can no longer use.
let onWaitlisted = null;
export function setWaitlistHandler(fn) { onWaitlisted = fn; }

async function request(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      // The server compares this against its own clock. Billing periods and
      // plan expiry depend on an accurate date, so a badly-wrong device is
      // refused rather than silently given the wrong answer.
      "X-Client-Time": String(Date.now()),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text.slice(0, 300) }; }
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    if (res.status === 403 && data?.code === "BETA_WAITLISTED") {
      try { onWaitlisted?.(); } catch { /* the error below is what matters */ }
    }
    if (data?.code === "CLOCK_SKEW") {
      err.serverTime = data.server_time;
      err.skewMs = data.skew_ms;
    }
    throw err;
  }
  return data;
}

export const api = {
  config:  ()      => request("/api/config"),
  betaConfig: ()   => request("/api/beta-config"),
  me:      ()      => request("/api/auth/me"),
  signup:  (body)  => request("/api/auth/signup", { method: "POST", body }),
  login:   (body)  => request("/api/auth/login",  { method: "POST", body }),
  logout:  ()      => request("/api/auth/logout", { method: "POST" }),
  updateMe:(body)  => request("/api/auth/me", { method: "PATCH", body }),
  changePassword: (body) => request("/api/auth/password", { method: "POST", body }),

  // Email verification and password recovery.
  confirmSignup: (email, code) =>
    request("/api/auth/signup/confirm", { method: "POST", body: { email, code } }),
  resendSignupCode: (email) =>
    request("/api/auth/signup/resend", { method: "POST", body: { email } }),
  verifyStatus: ()     => request("/api/auth/verify/status"),
  verifyEmail:  (code) => request("/api/auth/verify", { method: "POST", body: { code } }),
  verifyResend: ()     => request("/api/auth/verify/resend", { method: "POST" }),
  forgotPassword: (email) =>
    request("/api/auth/forgot", { method: "POST", body: { email } }),
  checkResetToken: (token) =>
    request(`/api/auth/reset/check?token=${encodeURIComponent(token)}`),
  resetPassword: (token, password) =>
    request("/api/auth/reset", { method: "POST", body: { token, password } }),
  mySearches: ()   => request("/api/me/searches"),
  mlVersion: ()    => request("/api/ml/version"),
  siteStats: ()    => request("/api/stats"),
  paymentConfig: () => request("/api/payments/config"),
  submitInstapay: (b) => request("/api/payments/instapay", { method: "POST", body: b }),
  previewPromo: (plan, code) =>
    request("/api/payments/promo", { method: "POST", body: { plan, code } }),
  redeemFree: (plan, code) =>
    request("/api/payments/redeem-free", { method: "POST", body: { plan, code } }),
  myPayments: ()   => request("/api/payments/mine"),
  adminPayments: (status) => request(`/api/admin/payments?status=${status || "pending"}`),
  adminReviewPayment: (id, action, note) =>
    request(`/api/admin/payments/${id}/${action}`, { method: "POST", body: { note } }),
  coachConfig: ()  => request("/api/coach/config"),
  pinnedPlan: ()   => request("/api/me/coach/pinned"),
  pinPlan: (runId) =>
    request("/api/me/coach/pin", { method: "POST", body: { run_id: runId } }),
  setCoachDay: (runId, day, done, topic) =>
    request("/api/me/coach/day", {
      method: "POST", body: { run_id: runId, day, done, topic },
    }),
  adminCoachStats: () => request("/api/admin/coach/stats"),
  coach: (body)    => request("/api/coach", { method: "POST", body }),
  adminCoach: ()   => request("/api/admin/coach"),
  adminSetCoachModel: (model) =>
    request("/api/admin/coach", { method: "PUT", body: { model } }),
  checkDiscount:  (c) => request(`/api/discounts/${encodeURIComponent(c)}`),
  redeemDiscount: (c) => request(`/api/discounts/${encodeURIComponent(c)}/redeem`, { method: "POST" }),
  adminDiscounts:      ()   => request("/api/admin/discounts"),
  adminCreateDiscount: (b)  => request("/api/admin/discounts", { method: "POST", body: b }),
  adminSetDiscount:    (id, active) => request(`/api/admin/discounts/${id}`, { method: "PATCH", body: { active } }),
  adminDeleteDiscount: (id) => request(`/api/admin/discounts/${id}`, { method: "DELETE" }),
  storedAnalysis: (id) => request(`/api/me/searches/${id}`),

  analyze: (handle, signal) =>
    request(`/api/ml/analyze/${encodeURIComponent(handle)}`, { signal }),
  cf:      (handle, signal) =>
    request(`/api/cf/${encodeURIComponent(handle)}`, { signal }),

  admin: {
    stats:    ()             => request("/api/admin/stats"),
    users:    (params = {})  => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return request(`/api/admin/users${q ? `?${q}` : ""}`);
    },
    user:     (id)           => request(`/api/admin/users/${id}`),
    update:   (id, body)     => request(`/api/admin/users/${id}`, { method: "PATCH", body }),
    remove:   (id)           => request(`/api/admin/users/${id}`, { method: "DELETE" }),
    searches: (limit = 100)  => request(`/api/admin/searches?limit=${limit}`),
  },
};
