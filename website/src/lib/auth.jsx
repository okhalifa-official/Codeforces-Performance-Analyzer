import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, setWaitlistHandler } from "./api.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [accountsEnabled, setAccountsEnabled] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const cfg = await api.config();
      setAccountsEnabled(Boolean(cfg?.accounts_enabled));
      if (!cfg?.accounts_enabled) { setUser(null); return; }
      const { user } = await api.me();
      setUser(user || null);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  // A 403 BETA_WAITLISTED from any route means this session's user object is
  // out of date. Re-read it once; the router then shows the waitlist screen.
  const waitlistRefreshing = useRef(false);
  useEffect(() => {
    setWaitlistHandler(() => {
      if (waitlistRefreshing.current) return;
      waitlistRefreshing.current = true;
      refresh().finally(() => { waitlistRefreshing.current = false; });
    });
    return () => setWaitlistHandler(null);
  }, [refresh]);

  // Bootstrapping the session is inherently an effect: it reads the cookie via
  // the API on mount and then stores the result. The lint rule targets
  // synchronous setState loops, which this is not.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  const value = {
    user, ready, accountsEnabled,
    isAdmin: user?.role === "admin",
    async login(body)  { const r = await api.login(body);  setUser(r.user); return r.user; },
    // Signup no longer returns a session: it starts a pending signup and the
    // account is created when the code is confirmed. Returns the raw response
    // so the form can move to its code step.
    async signup(body) { return api.signup(body); },
    async confirmSignup(email, code) {
      const r = await api.confirmSignup(email, code);
      setUser(r.user);
      return r.user;
    },
    async logout()     { await api.logout(); setUser(null); },
    setUser,
    refresh,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
