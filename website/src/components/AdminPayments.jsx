import { useState, useEffect, useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Button, Badge } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";

/** Review queue for InstaPay payments the verifier could not auto-approve. */
export default function AdminPayments() {
  const [tab, setTab] = useState("pending");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (status) => {
    try { setData(await api.adminPayments(status)); }
    catch (err) { setError(err.message || "Could not load payments."); }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(tab), 0);
    return () => clearTimeout(t);
  }, [load, tab]);

  async function review(id, action) {
    setBusy(id); setError("");
    try { await api.adminReviewPayment(id, action); await load(tab); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  if (!data) {
    return <Card style={{ padding: 22, color: T.textFaint, fontSize: 13.5 }}>
      {error || "Loading…"}
    </Card>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{
        display: "grid", gap: 1, overflow: "hidden",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        borderRadius: T.radius, background: T.border,
        border: `1px solid ${T.border}`,
      }}>
        {[
          { icon: "clock", tone: T.warn, value: data.counts?.pending ?? 0, label: "awaiting review" },
          { icon: "checkCircle", tone: T.good, value: data.counts?.approved ?? 0, label: "approved" },
          { icon: "tag", tone: T.accent, value: `${data.revenue.total.toLocaleString()}`, label: "EGP collected" },
          { icon: "calendar", tone: T.violet, value: `${data.revenue.last_30d.toLocaleString()}`, label: "EGP last 30 days" },
        ].map((s) => (
          <div key={s.label} style={{ background: T.surface, padding: 18 }}>
            <span style={{ color: s.tone, display: "block", marginBottom: 10 }}>
              <Icon name={s.icon} size={17} strokeWidth={1.8} />
            </span>
            <div style={{ fontFamily: font.mono, fontSize: 22, fontWeight: 820,
                          color: s.tone, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8,
                      padding: "15px 20px", borderBottom: `1px solid ${T.border}` }}>
          <IconTile name="tag" color={T.accent} size={28} iconSize={14} />
          <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>Payments</h3>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {["pending", "approved", "rejected"].map((s) => (
              <button key={s} onClick={() => { setData(null); setTab(s); }}
                style={{
                  padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                  fontFamily: font.sans, fontSize: 12.5, fontWeight: 600,
                  textTransform: "capitalize",
                  background: tab === s ? T.surfaceHi : "transparent",
                  border: `1px solid ${tab === s ? T.borderHi : "transparent"}`,
                  color: tab === s ? T.text : T.textDim,
                }}>{s}</button>
            ))}
          </div>
        </div>

        {error && <div style={{ padding: "12px 20px", fontSize: 13, color: T.risk }}>{error}</div>}

        {data.payments.length === 0 ? (
          <div style={{ padding: 30, color: T.textFaint, fontSize: 13.5 }}>
            Nothing {tab}.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {data.payments.map((p, i) => (
              <m.div key={p.id}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}
                style={{ padding: "16px 20px",
                         borderTop: i ? `1px solid ${T.border}` : "none" }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap",
                              alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9,
                                  flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 650, fontSize: 14 }}>{p.email}</span>
                      <span style={{ fontFamily: font.mono, fontSize: 12,
                                     color: T.textFaint }}>{p.cf_handle}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 5 }}>
                      {p.months} month{p.months === 1 ? "" : "s"} ·{" "}
                      <strong style={{ color: T.textDim, fontFamily: font.mono }}>
                        {/* A promo that covered the whole price records a 0
                            payment; "0 EGP" alone reads like a mistake. */}
                        {Number(p.amount) === 0
                          ? "Free (promo)"
                          : `${Number(p.amount)} ${p.currency}`}
                      </strong>
                      {" "}· {new Date(p.created_at).toLocaleString(undefined,
                        { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                    {p.instapay_reference && (
                      <div style={{ fontFamily: font.mono, fontSize: 11.5,
                                    color: T.textFaint, marginTop: 4 }}>
                        ref {p.instapay_reference}
                      </div>
                    )}
                  </div>

                  <Badge color={
                    p.auto_verdict === "verified" ? T.good
                    : p.auto_verdict === "rejected" ? T.risk : T.warn
                  }>
                    {p.auto_verdict === "needs_review" ? "needs a human" : p.auto_verdict}
                  </Badge>

                  {/* A pending row can be here because the model auto-rejected
                      it (a genuine payment it misread) rather than flagged it
                      for review. The badge above already says "rejected", but
                      that reads the same as a human decision -- call out that
                      this one is still the model's guess, waiting on a
                      person. */}
                  {p.status === "pending" && p.auto_verdict === "rejected" && (
                    <span style={{
                      fontSize: 11, fontWeight: 650, color: T.risk,
                      border: `1px solid ${T.risk}`, borderRadius: 6,
                      padding: "2px 7px", alignSelf: "flex-start",
                    }}>auto-rejected</span>
                  )}

                  {p.status === "pending" && (
                    <div style={{ display: "flex", gap: 7 }}>
                      <Button size="sm" variant="ghost" disabled={busy === p.id}
                              onClick={() => review(p.id, "reject")}>Reject</Button>
                      <Button size="sm" loading={busy === p.id}
                              onClick={() => review(p.id, "approve")}>Approve</Button>
                    </div>
                  )}
                </div>

                {/* What the verifier saw, so a decision needs no guesswork. */}
                {Array.isArray(p.checks) && p.checks.length > 0 && (
                  <div style={{ display: "grid", gap: 5, marginTop: 12,
                                paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
                    {p.checks.map((c) => (
                      <div key={c.name} style={{ display: "flex", gap: 9,
                                                 alignItems: "flex-start",
                                                 fontSize: 12.5, color: T.textDim }}>
                        <span style={{ color: c.passed ? T.good : T.risk, marginTop: 1 }}>
                          <Icon name={c.passed ? "check" : "cross"} size={12} strokeWidth={3} />
                        </span>
                        {c.detail}
                      </div>
                    ))}
                  </div>
                )}
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Card>
    </div>
  );
}
