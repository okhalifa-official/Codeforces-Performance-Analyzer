import { useState, useEffect, useRef } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Button, Badge } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";
import { ReportIssueButton } from "./Footer.jsx";
import { SUPPORT_EMAIL, PAYMENT_ISSUE_MAILTO } from "../lib/contact.js";

/** InstaPay checkout: pick a term, transfer, upload the receipt.
 *
 *  Three steps rather than one form, because the middle step is a real-world
 *  action in another app — the user has to leave, pay, and come back. */
export default function Checkout({ onDone }) {
  const [cfg, setCfg] = useState(null);
  const [plan, setPlan] = useState("quarterly");
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  // A promo is entered here, not claimed in advance. `promo` holds the
  // server's verdict for the CURRENT plan; changing plan clears it, because a
  // scoped code may not apply to the new one.
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const inputRef = useRef(null);

  // Digits only. References print as one long number, and people paste them
  // with stray spaces.
  const refDigits = reference.replace(/\D/g, "");
  const refLooksValid = refDigits.length >= 6 && refDigits.length <= 24;

  useEffect(() => {
    let alive = true;
    api.paymentConfig?.()
      .then((c) => { if (alive) setCfg(c); })
      .catch(() => { if (alive) setError("Could not load the payment details."); });
    return () => { alive = false; };
  }, []);

  if (!cfg) {
    return <Card style={{ padding: 26, color: T.textFaint, fontSize: 13.5 }}>
      {error || "Loading…"}
    </Card>;
  }

  if (!cfg.configured) {
    return (
      <Card style={{ padding: 24, display: "flex", gap: 12 }}>
        <span style={{ color: T.warn, marginTop: 1 }}><Icon name="alert" size={16} /></span>
        <div style={{ fontSize: 13.5, color: T.textDim, lineHeight: 1.65 }}>
          Payments are not switched on yet. Check back shortly.
        </div>
      </Card>
    );
  }

  const chosen = cfg.plans.find((p) => p.key === plan) || cfg.plans[0];
  // What to actually transfer: the promo price when one is applied, otherwise
  // the plan price. Verification checks the receipt against this exact figure.
  const payable = promo && !promo.free ? promo.price : chosen.price_after_discount;

  function pickFile(f) {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { setError("That image is over 8 MB."); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, dataUrl: reader.result });
    reader.readAsDataURL(f);
  }


  /** Check a code against the chosen plan. Consumes nothing. */
  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoBusy(true); setPromoError(""); setPromo(null);
    try {
      const r = await api.previewPromo(plan, code);
      setPromo(r);
    } catch (err) {
      setPromoError(err.message || "That code could not be used.");
    } finally {
      setPromoBusy(false);
    }
  }

  /** A code covering the whole price: no transfer, access straight away. */
  async function claimFree() {
    setBusy(true); setError("");
    try {
      const r = await api.redeemFree(plan, promo.code);
      setResult(r);   // `result` short-circuits the whole panel to Outcome
    } catch (err) {
      setError(err.message || "Could not grant access.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const r = await api.submitInstapay({
        plan, screenshot: file.dataUrl, reference: refDigits,
        code: promo?.code || undefined,
      });
      setResult(r);
      if (r.status === "approved") onDone?.();
    } catch (err) {
      setError(err.message || "Could not submit that.");
    } finally {
      setBusy(false);
    }
  }

  if (result) return <Outcome result={result} onRetry={() => { setResult(null); setFile(null); setStep(1); }} />;

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11,
                    padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
        <IconTile name="diamond" color={T.violet} size={32} iconSize={16} />
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Get Plus</h3>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 2 }}>
            Pay by InstaPay
          </div>
        </div>
        {cfg.discount && (
          <Badge color={T.good} style={{ marginLeft: "auto" }}>
            {cfg.discount.percent_off}% off applied
          </Badge>
        )}
      </div>

      <div style={{ padding: 22 }}>
        <Steps step={step} />

        {/* 1 — choose a term */}
        {step === 1 && (
          <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
            {cfg.plans.map((p) => {
              const active = p.key === plan;
              // The server sends both numbers, so the strike-through can never
              // disagree with what is actually charged.
              const saving = p.saving ?? 0;
              const savingPct = p.saving_percent ?? 0;
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    setPlan(p.key);
                    // A code valid for one term may not cover another, so the
                    // preview is re-fetched rather than carried over.
                    setPromo(null); setPromoError("");
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 13, width: "100%",
                    padding: "15px 16px", borderRadius: T.radiusSm, cursor: "pointer",
                    textAlign: "left", fontFamily: font.sans, color: T.text,
                    background: active ? T.surfaceHi : T.bgAlt,
                    border: `1px solid ${active ? T.accent : T.border}`,
                  }}
                >
                  <span style={{
                    width: 17, height: 17, borderRadius: 999, flexShrink: 0,
                    display: "grid", placeItems: "center",
                    border: `2px solid ${active ? T.accent : T.borderHi}`,
                  }}>
                    {active && <span style={{ width: 7, height: 7, borderRadius: 999,
                                              background: T.accent }} />}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8,
                                   flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14.5, fontWeight: 650 }}>
                        {p.label}
                      </span>
                      {saving > 0 && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
                          padding: "2.5px 7px", borderRadius: 999,
                          color: T.good, background: `${T.good}1a`,
                          border: `1px solid ${T.good}40`,
                        }}>
                          Save {saving} EGP · {savingPct}%
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 12.5,
                                   color: T.textFaint, marginTop: 4 }}>
                      {p.per_month} EGP / month
                    </span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {saving > 0 && (
                      <span style={{ display: "block", fontFamily: font.mono,
                                     fontSize: 12.5, color: T.textFaint,
                                     textDecoration: "line-through" }}>
                        {p.list_price}
                      </span>
                    )}
                    <span style={{ fontFamily: font.mono, fontSize: 19, fontWeight: 800 }}>
                      {p.price_after_discount}
                    </span>
                    <span style={{ fontSize: 12, color: T.textFaint }}> EGP</span>
                  </span>
                </button>
              );
            })}
            {/* Promo entry lives with the plan choice: the discount depends on
                which term is selected, so the two belong together. */}
            <div style={{ marginTop: 4 }}>
              {!promo ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={promoInput}
                      onChange={(e) => { setPromoInput(e.target.value); setPromoError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } }}
                      placeholder="Promo code"
                      aria-label="Promo code"
                      autoComplete="off"
                      style={{
                        flex: 1, padding: "10px 13px", borderRadius: T.radiusSm,
                        background: T.bgAlt, color: T.text,
                        border: `1px solid ${promoError ? T.risk : T.borderHi}`,
                        fontFamily: font.sans, fontSize: 13.5,
                        letterSpacing: 0.5, textTransform: "uppercase",
                        outline: "none",
                      }}
                    />
                    <Button variant="subtle" onClick={applyPromo}
                            loading={promoBusy}
                            disabled={promoBusy || !promoInput.trim()}>
                      Apply
                    </Button>
                  </div>
                  {promoError && (
                    <div style={{ fontSize: 12.5, color: T.risk, marginTop: 8,
                                  lineHeight: 1.5 }}>
                      {promoError}
                    </div>
                  )}
                </>
              ) : (
                <m.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "12px 14px", borderRadius: T.radiusSm,
                    background: `${T.good}12`, border: `1px solid ${T.good}44`,
                  }}
                >
                  <span style={{ color: T.good, display: "flex" }}>
                    <Icon name="checkCircle" size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 650 }}>
                      {promo.code} — {promo.percent_off}% off
                    </div>
                    <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
                      {promo.free
                        ? "This covers the whole price."
                        : `You pay ${promo.price} ${cfg.currency} instead of ${promo.original_price}.`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPromo(null); setPromoInput(""); }}
                    aria-label="Remove promo code"
                    style={{ background: "none", border: "none", padding: 4,
                             cursor: "pointer", color: T.textFaint, display: "flex" }}
                  >
                    <Icon name="cross" size={14} />
                  </button>
                </m.div>
              )}
            </div>

            <div style={{ marginTop: 6 }}>
              {/* At zero there is nothing to transfer, so the InstaPay steps
                  are skipped entirely. */}
              {promo?.free ? (
                <Button onClick={claimFree} loading={busy} disabled={busy}
                        style={{ width: "100%" }}>
                  {busy ? "Unlocking" : "Get Plus free"}
                </Button>
              ) : (
                <Button onClick={() => setStep(2)} style={{ width: "100%" }}>
                  Continue
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 2 — transfer */}
        {step === 2 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13.5, color: T.textDim, lineHeight: 1.65,
                        margin: "0 0 16px" }}>
              Open InstaPay and send exactly this amount to this handle.
            </p>

            <CopyRow label="Amount" value={`${payable} ${cfg.currency}`} mono />
            <CopyRow label="Send to" value={cfg.handle} mono />

            <div style={{ display: "flex", gap: 11, alignItems: "flex-start",
                          padding: "13px 15px", borderRadius: T.radiusSm,
                          background: `${T.warn}0d`, border: `1px solid ${T.warn}33`,
                          margin: "16px 0 18px" }}>
              <span style={{ color: T.warn, marginTop: 1 }}>
                <Icon name="alert" size={15} />
              </span>
              <div style={{ fontSize: 12.5, color: T.textDim, lineHeight: 1.6 }}>
                Send the exact amount. A different figure cannot be matched to
                your account automatically.
              </div>
            </div>

            <div style={{ display: "flex", gap: 9 }}>
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} style={{ flex: 1 }}>
                I have sent it
              </Button>
            </div>
          </div>
        )}

        {/* 3 — upload the receipt */}
        {step === 3 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13.5, color: T.textDim, lineHeight: 1.65,
                        margin: "0 0 16px" }}>
              Enter the reference number from your receipt and attach the
              screenshot. Most are checked in a few seconds.
            </p>

            {/* Typed separately from the screenshot on purpose: checking the
                two against each other is what a borrowed receipt cannot
                survive. */}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="instapay-ref" style={{
                display: "block", fontSize: 12, color: T.textFaint,
                letterSpacing: 0.4, textTransform: "uppercase",
                marginBottom: 7,
              }}>
                Reference number
              </label>
              <input
                id="instapay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="246706789697"
                aria-label="Transaction reference number"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "12px 14px", borderRadius: T.radiusSm,
                  background: T.bgAlt, color: T.text,
                  fontFamily: font.mono, fontSize: 15, letterSpacing: 1,
                  border: `1px solid ${
                    reference && !refLooksValid ? T.risk : T.borderHi}`,
                  outline: "none",
                }}
              />
              <div style={{ fontSize: 12, color: T.textFaint, marginTop: 7,
                            lineHeight: 1.55 }}>
                The long number labelled <strong style={{ color: T.textDim }}>
                Reference</strong> on your transfer receipt. It must match the
                screenshot.
              </div>
            </div>

            <button
              onClick={() => inputRef.current?.click()}
              style={{
                width: "100%", padding: "26px 20px", borderRadius: T.radiusSm,
                cursor: "pointer", fontFamily: font.sans, color: T.text,
                background: T.bgAlt, border: `1px dashed ${file ? T.good : T.borderHi}`,
                display: "grid", placeItems: "center", gap: 9,
              }}
            >
              <span style={{ color: file ? T.good : T.textFaint }}>
                <Icon name={file ? "checkCircle" : "layers"} size={22} />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                {file ? file.name : "Choose a screenshot"}
              </span>
              <span style={{ fontSize: 12, color: T.textFaint }}>
                PNG or JPG, up to 8 MB
              </span>
            </button>
            <input
              ref={inputRef} type="file" accept="image/*" hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />

            {error && (
              <div style={{ fontSize: 13, color: T.risk, marginTop: 12 }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
              <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                Back
              </Button>
              <Button onClick={submit} loading={busy}
                      disabled={!file || !refLooksValid || busy}
                      style={{ flex: 1 }}>
                {busy ? "Checking your receipt" : "Submit"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Steps({ step }) {
  const labels = ["Choose", "Transfer", "Confirm"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {labels.map((l, i) => {
        const n = i + 1;
        const done = n < step, now = n === step;
        return (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8,
                                flex: i < 2 ? 1 : "0 0 auto" }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999, flexShrink: 0,
              display: "grid", placeItems: "center",
              fontFamily: font.mono, fontSize: 11, fontWeight: 700,
              background: done ? T.good : now ? T.accent : T.bgAlt,
              color: done || now ? "#07080B" : T.textFaint,
              border: `1px solid ${done ? T.good : now ? T.accent : T.border}`,
            }}>
              {done ? "✓" : n}
            </span>
            <span style={{ fontSize: 12.5, color: now ? T.text : T.textFaint,
                           fontWeight: now ? 650 : 500 }}>
              {l}
            </span>
            {i < 2 && <span style={{ flex: 1, height: 1, background: T.border }} />}
          </div>
        );
      })}
    </div>
  );
}

function CopyRow({ label, value, mono }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12,
                  padding: "13px 15px", borderRadius: T.radiusSm,
                  background: T.bgAlt, border: `1px solid ${T.border}`,
                  marginBottom: 9 }}>
      <span style={{ fontSize: 12, color: T.textFaint, minWidth: 62 }}>{label}</span>
      <span style={{ flex: 1, fontFamily: mono ? font.mono : font.sans,
                     fontSize: 15, fontWeight: 700, wordBreak: "break-all" }}>
        {value}
      </span>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1600); },
            () => {},
          );
        }}
        style={{
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "6px 11px", borderRadius: 7, cursor: "pointer",
          fontFamily: font.sans, fontSize: 12, fontWeight: 600,
          color: copied ? T.good : T.textDim,
          background: "transparent",
          border: `1px solid ${copied ? T.good : T.border}`,
        }}
      >
        <Icon name={copied ? "check" : "layers"} size={12} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Outcome({ result, onRetry }) {
  const map = {
    approved: {
      icon: "checkCircle", tone: T.good,
      title: result.free ? "Your code covered it" : "You're on Plus",
      body: result.free
        ? `${result.code} covered the whole price. `
          + `${result.months} month${result.months === 1 ? "" : "s"} of Plus `
          + "is on your account — nothing to pay."
        : `${result.months} month${result.months === 1 ? "" : "s"} added to your account. Everything is unlocked now.` },
    pending: { icon: "clock", tone: T.warn, title: "Sent for review",
      body: "We could not confirm every detail automatically, so a human will check it. You'll have Plus as soon as it's approved — usually within a day." },
    // A rejection is never final: automatic checks read a screenshot with a
    // model, and a model can misread a digit. The title says what happened and
    // the body says what happens next, so nobody thinks their money is gone.
    rejected: { icon: "alert", tone: T.warn,
      title: "We couldn't verify that automatically",
      body: "Your transfer has not been lost. Here is what did not match — a human will review it and approve it manually if the payment is genuine." },
  };
  const s = map[result.status] || map.pending;

  return (
    <Card style={{ padding: 28, textAlign: "center" }}>
      <m.div
        initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 18 }}
        style={{ display: "inline-grid", placeItems: "center", width: 54, height: 54,
                 borderRadius: 999, background: `${s.tone}18`,
                 border: `1px solid ${s.tone}55`, color: s.tone, marginBottom: 16 }}
      >
        <Icon name={s.icon} size={24} strokeWidth={2.2} />
      </m.div>

      <h3 style={{ fontSize: 19, fontWeight: 750, margin: "0 0 9px" }}>{s.title}</h3>

      {s.body && (
        <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.65,
                    margin: "0 auto", maxWidth: 380 }}>
          {s.body}
        </p>
      )}

      {result.status === "rejected" && (
        <div style={{ display: "grid", gap: 8, margin: "16px auto 0", maxWidth: 400,
                      textAlign: "left" }}>
          {(result.reasons || []).map((r) => (
            <div key={r} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                                  padding: "11px 13px", borderRadius: T.radiusSm,
                                  background: T.bgAlt, border: `1px solid ${T.border}`,
                                  fontSize: 13, color: T.textDim, lineHeight: 1.55 }}>
              <span style={{ color: T.risk, marginTop: 1 }}>
                <Icon name="cross" size={13} />
              </span>
              {r}
            </div>
          ))}
        </div>
      )}

      {result.status === "rejected" && (
        <p style={{ color: T.textFaint, fontSize: 12.5, lineHeight: 1.6,
                    margin: "14px auto 0", maxWidth: 400 }}>
          Waiting for manual approval. If this looks wrong, email{" "}
          <a href={PAYMENT_ISSUE_MAILTO}
             style={{ color: T.accent, textDecoration: "none" }}>
            {SUPPORT_EMAIL}
          </a>{" "}
          with your transaction reference — please don&rsquo;t post payment
          details publicly.
        </p>
      )}

      {result.status !== "approved" && (
        <div style={{ marginTop: 20, display: "flex", gap: 10,
                      justifyContent: "center", flexWrap: "wrap" }}>
          <Button variant="subtle" onClick={onRetry}>
            {result.status === "rejected" ? "Try again" : "Done"}
          </Button>
          {result.status === "rejected" && <ReportIssueButton />}
        </div>
      )}
    </Card>
  );
}
