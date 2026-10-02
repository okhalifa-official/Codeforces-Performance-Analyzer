import { useState } from "react";
import { m } from "framer-motion";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { T } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import { Button, Field, Input, Card } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";

export function Login()  { return <AuthForm mode="login" />; }
export function Signup() { return <AuthForm mode="signup" />; }

function AuthForm({ mode }) {
  const isSignup = mode === "signup";
  const { login, signup, confirmSignup } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: "", password: "", cf_handle: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Set once a signup is awaiting its code. The account does not exist yet,
  // so this step is not optional and there is nothing to sign in to.
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isSignup) {
        const r = await signup(form);
        setPending(r?.email || form.email);
        setNote("");
        return;
      }
      const user = await login(form);
      const to = loc.state?.from
        || (user.role === "admin" ? "/admin" : "/dashboard");
      nav(to, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const user = await confirmSignup(pending, code.replace(/\D/g, ""));
      nav(user.role === "admin" ? "/admin" : "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(""); setNote(""); setBusy(true);
    try {
      await api.resendSignupCode(pending);
      setNote("A new code is on its way.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", minHeight: "calc(100vh - 66px)",
                  display: "grid", placeItems: "center", padding: "48px 20px" }}>
      <Aurora intensity={0.55} />
      <m.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 430, position: "relative", zIndex: 1 }}
      >
        <Card style={{ padding: 32 }}>
          {pending ? (
            <>
              <h1 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 6px",
                           letterSpacing: -0.5 }}>
                Check your email
              </h1>
              <p style={{ color: T.textDim, fontSize: 14, margin: "0 0 24px",
                          lineHeight: 1.6 }}>
                We sent a 6-digit code to <strong style={{ color: T.text }}>
                {pending}</strong>. Your account is created once you enter it.
                <br />
                <strong style={{ color: T.text }}>Can&apos;t see it?</strong> Check
                your spam or junk folder. It can take a minute to arrive.
              </p>

              <form onSubmit={confirm}>
                <Field label="Verification code" required>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="000000"
                    autoFocus
                    style={{ fontFamily: "ui-monospace, monospace",
                             fontSize: 18, letterSpacing: 5 }}
                  />
                </Field>

                {error && (
                  <div style={{ padding: "11px 14px", borderRadius: 10,
                                marginBottom: 14, background: `${T.risk}14`,
                                border: `1px solid ${T.risk}44`, color: T.risk,
                                fontSize: 13.5, lineHeight: 1.5 }}>
                    {error}
                  </div>
                )}
                {note && (
                  <div style={{ marginBottom: 14, fontSize: 13, color: T.good }}>
                    {note}
                  </div>
                )}

                <Button type="submit" loading={busy}
                        disabled={busy || code.replace(/\D/g, "").length !== 6}
                        style={{ width: "100%" }} size="lg">
                  Create my account
                </Button>
              </form>

              <div style={{ marginTop: 18, display: "flex", gap: 14,
                            justifyContent: "center", fontSize: 13 }}>
                <button type="button" onClick={resend} disabled={busy}
                        style={{ background: "none", border: "none", padding: 0,
                                 cursor: "pointer", color: T.accent,
                                 fontWeight: 600, font: "inherit" }}>
                  Send a new code
                </button>
                <button type="button" disabled={busy}
                        onClick={() => { setPending(null); setCode(""); setError(""); }}
                        style={{ background: "none", border: "none", padding: 0,
                                 cursor: "pointer", color: T.textFaint,
                                 font: "inherit" }}>
                  Use a different email
                </button>
              </div>
            </>
          ) : (
          <>
          <h1 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 6px",
                       letterSpacing: -0.5 }}>
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p style={{ color: T.textDim, fontSize: 14, margin: "0 0 26px",
                      lineHeight: 1.6 }}>
            {isSignup
              ? "Three fields to start. Everything else can wait."
              : "Sign in to pick up where you left off."}
          </p>

          <form onSubmit={submit} noValidate>
            <Field label="Email" required>
              <Input
                type="email" value={form.email} onChange={set("email")}
                placeholder="you@example.com" autoComplete="email" required
              />
            </Field>

            {isSignup && (
              <Field
                label="Codeforces handle" required
                hint="We use this to pull your submission history."
              >
                <Input
                  value={form.cf_handle} onChange={set("cf_handle")}
                  placeholder="tourist" autoComplete="username" required
                />
              </Field>
            )}

            <Field
              label="Password" required
              hint={isSignup ? "At least 8 characters." : undefined}
            >
              <Input
                type="password" value={form.password} onChange={set("password")}
                placeholder="••••••••"
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
              />
            </Field>

            {error && (
              <m.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  padding: "11px 14px", borderRadius: 10, marginBottom: 16,
                  background: `${T.risk}14`, border: `1px solid ${T.risk}44`,
                  color: T.risk, fontSize: 13.5, lineHeight: 1.5,
                }}
              >
                {error}
              </m.div>
            )}

            {/* Acceptance is implicit in creating the account, so it is
                stated next to the button rather than hidden behind a checkbox
                nobody reads. */}
            {isSignup && (
              <p style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.6,
                          margin: "0 0 14px", textAlign: "center" }}>
                By creating an account you agree to our{" "}
                <Link to="/terms" style={{ color: T.textDim, fontWeight: 600 }}>
                  Terms and Conditions
                </Link>.
              </p>
            )}

            <Button type="submit" loading={busy} disabled={busy}
                    style={{ width: "100%" }} size="lg">
              {isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          {!isSignup && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <Link to="/forgot-password"
                    style={{ color: T.textDim, fontSize: 13, textDecoration: "none" }}>
                Forgot your password?
              </Link>
            </div>
          )}

          <div style={{ marginTop: 22, textAlign: "center", fontSize: 13.5,
                        color: T.textDim }}>
            {isSignup ? "Already have an account? " : "New here? "}
            <Link
              to={isSignup ? "/login" : "/signup"}
              style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}
            >
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </div>
          </>
          )}
        </Card>
      </m.div>
    </div>
  );
}
