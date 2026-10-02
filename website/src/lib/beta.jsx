import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

/* The site is released as a closed beta: Free tier only, no Plus, no AI Coach,
 * and only the first N accounts are let in. The server owns the flag; this
 * context reads it once so every screen agrees about which product it is.
 *
 * Until the answer arrives, and if it never does, beta counts as ON. Wrongly
 * showing a Plus upsell that the server then refuses is worse than briefly
 * showing the smaller product, and the shell holds its first paint until
 * `loaded` anyway, so in practice nobody sees the guess. */
const DEFAULT = { beta: true, maxAccounts: 100, loaded: false };
const Ctx = createContext(DEFAULT);

export function BetaProvider({ children }) {
  const [state, setState] = useState(DEFAULT);

  // One fetch for the life of the page: it is a deployment setting, not
  // something that changes under a visitor.
  useEffect(() => {
    let alive = true;
    api.betaConfig()
      .then((c) => {
        if (!alive) return;
        setState({
          beta: c?.beta !== false,
          maxAccounts: Number(c?.maxAccounts) > 0 ? Number(c.maxAccounts) : 100,
          loaded: true,
        });
      })
      .catch(() => { if (alive) setState({ ...DEFAULT, loaded: true }); });
    return () => { alive = false; };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** { beta, maxAccounts, loaded } */
export function useBeta() {
  return useContext(Ctx);
}
