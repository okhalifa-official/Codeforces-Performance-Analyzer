import { useState, useEffect, useRef, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font, band } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import { Button, Input, Card, Spinner, Badge, Toast } from "../components/ui.jsx";
import Results from "../components/Results.jsx";
import Compare from "../components/Compare.jsx";
import ClockWarning, { useClockCheck } from "../components/ClockWarning.jsx";
import VerifyBanner from "../components/VerifyBanner.jsx";
import PinnedPlan from "../components/PinnedPlan.jsx";
import { shouldShowUpgrade } from "../components/UpgradeGate.jsx";
import { useUpgrade } from "../lib/upgrade.jsx";
import { useBeta } from "../lib/beta.jsx";
import { tagInfo } from "../lib/copy.js";
import Icon, { IconTile } from "../components/Icon.jsx";

// Shown while the pipeline runs. Deliberately about the user's data, not about
// what the system is doing internally.
const STEPS = [
  "Reading your submission history",
  "Scoring each topic",
  "Comparing against your rating band",
  "Choosing problems worth your time",
];

export default function Dashboard() {
  const { user, refresh: refreshUser } = useAuth();
  const [handle, setHandle] = useState(user?.cf_handle || "");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState([]);
  const [compareWith, setCompareWith] = useState(null);
  // id of the search row created by the run currently on screen
  const [lastRunId, setLastRunId] = useState(null);
  // The post-login Plus screen, shown to free accounts at most once a week.
  // Never in the beta: there is no Plus to offer.
  const upgrade = useUpgrade();
  const { beta } = useBeta();
  useEffect(() => {
    if (!beta && shouldShowUpgrade(user)) {
      // A beat after the dashboard paints, so it arrives as a moment rather
      // than blocking the page the user asked for.
      const t = setTimeout(() => upgrade.show(), 700);
      return () => clearTimeout(t);
    }
  }, [user, upgrade, beta]);
  // Set when the view is a stored run rather than a fresh one.
  const [viewingSaved, setViewingSaved] = useState(null);
  const [loadingSaved, setLoadingSaved] = useState(null);
  const abortRef = useRef(null);
  const isAdmin = user?.role === "admin";
  const clock = useClockCheck();
  const clockBad = clock.checked && !clock.ok;

  // Flatten the current result the same way the server stores snapshots, so
  // today's numbers and a saved run are directly comparable.
  const currentScores = useMemo(() => {
    const ts = data?.tag_strengths;
    if (!ts) return null;
    const out = {};
    for (const [k, v] of Object.entries(ts)) {
      const n = typeof v === "object"
        ? (v?.strength ?? v?.user_strength ?? v?.score)
        : v;
      if (Number.isFinite(Number(n))) out[k] = Math.round(Number(n) * 10) / 10;
    }
    return Object.keys(out).length ? out : null;
  }, [data]);

  // Earlier runs for the SAME handle that captured scores. Comparing across
  // handles would be meaningless.
  const comparable = useMemo(() => {
    if (!data || !handle) return [];
    return history.filter(h =>
      h.comparable &&
      String(h.cf_handle).toLowerCase() === handle.trim().toLowerCase() &&
      // History reloads after each run, so the run just displayed is in this
      // list. Comparing it with itself would show zero change everywhere.
      h.id !== lastRunId);
  }, [history, data, handle, lastRunId]);

  useEffect(() => { loadHistory(); }, []);
  async function loadHistory() {
    try { const r = await api.mySearches(); setHistory(r.searches || []); }
    catch { /* history is a nicety, never block the page on it */ }
  }

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => clearInterval(t);
  }, [busy]);

  // Re-open a past analysis from storage. No model run: the stored payload is
  // exactly what was shown at the time.
  async function openSaved(h) {
    setLoadingSaved(h.id);
    setError("");
    try {
      const saved = await api.storedAnalysis(h.id);
      setHandle(saved.target_user || h.cf_handle);
      setData(saved);
      setLastRunId(h.id);
      setCompareWith(null);
      setViewingSaved({ id: h.id, at: saved.searched_at || h.searched_at });
    } catch (err) {
      // Runs from before results were stored cannot be re-opened.
      if (err.code === "NO_STORED_RESULT") {
        setHandle(h.cf_handle);
        setError(err.message);
      } else {
        setError(err.message || "Could not open that analysis.");
      }
    } finally {
      setLoadingSaved(null);
    }
  }

  async function run(e) {
    e?.preventDefault();
    return runHandle(handle);
  }

  /** Analyse a specific handle. Split out from the form submit so the
   *  "analyse my profile" button and the other-handle form can share it
   *  without one of them having to fake an event. */
  async function runHandle(raw) {
    const h = String(raw || "").trim();
    if (!h) return;
    if (h.toLowerCase() !== handle.trim().toLowerCase()) setHandle(h);
    if (clockBad) {
      setError("Your device clock is wrong. Fix the date and time, then try again.");
      return;
    }
    setBusy(true); setError(""); setData(null); setStep(0);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const result = await api.analyze(h, abortRef.current.signal);
      if (result?.error) throw new Error(result.error);
      if (!result?.tag_strengths) {
        throw new Error(
          "We could not build a profile for that handle. It may have too few rated submissions yet."
        );
      }
      setData(result);
      setViewingSaved(null);
      setLastRunId(result.run_id ?? null);
      setCompareWith(null);
      loadHistory();
      // A run against another handle spends the allowance; refresh the user so
      // the countdown in the panel reflects it immediately.
      if (h.toLowerCase() !== String(user?.cf_handle || "").toLowerCase()) {
        refreshUser?.();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(
          err.message?.includes("timed out")
            ? "That took longer than expected. Try again in a moment."
            : err.message
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 22px 90px" }}>
      <m.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1 style={{ fontSize: 30, fontWeight: 780, margin: "0 0 8px",
                     letterSpacing: -0.9 }}>
          {user?.full_name ? `Hey ${user.full_name.split(" ")[0]}.` : "Your analysis"}
        </h1>
        <p style={{ color: T.textDim, fontSize: 15, margin: "0 0 26px" }}>
          {isAdmin
            ? "Enter any Codeforces handle to see where the gaps are."
            : "See where your gaps are, and what to practise next."}
        </p>
      </m.div>

      {/* Renders nothing once the address is confirmed. */}
      <VerifyBanner />

      {/* The week's work, first thing. Renders nothing without a pinned plan. */}
      {!beta && <PinnedPlan onOpenRun={(id, handle) => openSaved({ id, cf_handle: handle })} />}

      {clockBad && (
        <ClockWarning
          skewMs={clock.skewMs}
          serverTime={clock.serverTime}
          deviceTime={clock.deviceTime}
          onRecheck={clock.recheck}
        />
      )}

      <Card style={{
        padding: 22, marginBottom: 26,
        background: `linear-gradient(180deg, ${T.accent}0a, transparent 60%), ${T.surface}`,
        borderColor: T.borderHi,
      }}>
        {isAdmin ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 9,
                          marginBottom: 14 }}>
              <IconTile name="search" color={T.accent} size={30} iconSize={15} />
              <span style={{ fontSize: 13, fontWeight: 650, color: T.textDim,
                             letterSpacing: 0.3 }}>
                Analyse a handle
              </span>
            </div>
            <form onSubmit={run} style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="Codeforces handle"
                style={{ flex: 1, minWidth: 220 }}
                disabled={busy}
                aria-label="Codeforces handle"
              />
              <Button type="submit" loading={busy}
                      disabled={busy || !handle.trim() || clockBad}>
                {busy ? "Analysing" : "Analyse"}
              </Button>
              {user?.cf_handle && handle !== user.cf_handle && !busy && (
                <Button type="button" variant="ghost"
                        onClick={() => setHandle(user.cf_handle)}>
                  Use mine
                </Button>
              )}
            </form>
            <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 10 }}>
              As an admin you can analyse any handle.
            </div>
          </>
        ) : (
          <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap",
                        alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <IconTile name="user" color={T.accent} size={38} iconSize={18} />
              <div>
              <div style={{ fontSize: 12, color: T.textFaint, letterSpacing: 0.6,
                            textTransform: "uppercase", marginBottom: 6 }}>
                Your linked handle
              </div>
              <div style={{ fontFamily: font.mono, fontSize: 17, fontWeight: 700 }}>
                {user?.cf_handle}
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 7 }}>
                {user?.limits?.own_handle_per_week
                  ? `${user.limits.own_handle_per_week} analyses a week, at least 24h apart.`
                  : "Unlimited runs on your own handle."}
              </div>
              </div>
            </div>
            <Button onClick={() => runHandle(user?.cf_handle)} loading={busy}
                    disabled={busy || clockBad} size="lg">
              {busy ? "Analysing" : "Analyse my profile"}
            </Button>
          </div>
          <OtherHandle
            limits={user?.limits?.other_handle}
            busy={busy}
            clockBad={clockBad}
            onRun={runHandle}
          />
          </>
        )}
      </Card>

      <AnimatePresence mode="wait">
        {busy && (
          <m.div
            key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <Card style={{ padding: 44, textAlign: "center" }}>
              <Spinner size={30} color={T.accent} />
              <AnimatePresence mode="wait">
                <m.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
                  style={{ marginTop: 20, fontSize: 15, color: T.textDim }}
                >
                  {STEPS[step]}…
                </m.div>
              </AnimatePresence>
              <div style={{ marginTop: 10, fontSize: 12.5, color: T.textFaint }}>
                This usually takes 30 to 60 seconds.
              </div>
            </Card>
          </m.div>
        )}

        {!busy && error && (
          <m.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card style={{ borderColor: `${T.risk}55`, padding: 26 }}>
              <div style={{ color: T.risk, fontWeight: 650, marginBottom: 6 }}>
                Could not complete that analysis
              </div>
              <div style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6 }}>
                {error}
              </div>
            </Card>
          </m.div>
        )}

        {!busy && data && (
          <m.div key="data" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div style={{ display: "grid", gap: 22 }}>
              {viewingSaved && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  padding: "12px 16px", borderRadius: T.radiusSm,
                  background: T.bgAlt, border: `1px solid ${T.border}`,
                }}>
                  <span style={{ fontSize: 13.5, color: T.textDim }}>
                    Saved analysis from{" "}
                    <strong style={{ color: T.text }}>
                      {new Date(viewingSaved.at).toLocaleString(undefined,
                        { dateStyle: "medium", timeStyle: "short" })}
                    </strong>
                    . Nothing was re-run.
                  </span>
                  <Button
                    variant="subtle" onClick={run} loading={busy}
                    disabled={busy || clockBad}
                    style={{ marginLeft: "auto" }}
                  >
                    Run a fresh analysis
                  </Button>
                </div>
              )}

              {comparable.length > 0 && (
                <CompareBar
                  options={comparable}
                  selected={compareWith}
                  onSelect={setCompareWith}
                />
              )}
              {compareWith && currentScores && (
                <Compare
                  current={currentScores}
                  previous={compareWith}
                  onClose={() => setCompareWith(null)}
                />
              )}
              <Results
                data={data}
                handle={handle}
                userRating={data?.recommendation?.recommendation?.cf_rating
                         ?? data?.cf_rating ?? null}
                isPro={user?.plan === "pro"}
                isAdmin={isAdmin}
                onUpgrade={upgrade.show}
              />
            </div>
          </m.div>
        )}

        {!busy && !data && !error && history.length === 0 && (
          <m.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card style={{ padding: 40 }}>
              <h3 style={{ fontSize: 19, fontWeight: 720, margin: "0 0 10px" }}>
                What you will get
              </h3>
              <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.7,
                          margin: "0 0 22px", maxWidth: 560 }}>
                Every topic scored from 0 to 100 against competitors in your
                rating band, the handful worth practising first, and specific
                problems to open next.
              </p>
              <div style={{ display: "grid", gap: 12,
                            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
                {[
                  ["Topic scores", "Where you stand in all 20 topics."],
                  ["Your focus list", "The few topics with the most to gain."],
                  ["Problems to solve", "Matched to your level, not random."],
                ].map(([t, d]) => (
                  <div key={t} style={{
                    padding: 15, borderRadius: 10, background: T.bgAlt,
                    border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 5 }}>
                      {t}
                    </div>
                    <div style={{ fontSize: 12.5, color: T.textFaint,
                                  lineHeight: 1.55 }}>{d}</div>
                  </div>
                ))}
              </div>
            </Card>
          </m.div>
        )}

        {!busy && !data && !error && (
          <m.div key="hist" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                 style={{ display: "grid", gap: 20 }}>
            {history.length > 0 && <HistoryStats history={history} />}
            {history.length > 0 ? (
              <RecentRuns
                history={history}
                onOpen={openSaved}
                loadingId={loadingSaved}
              />
            ) : (
              <FirstRunHint />
            )}
          </m.div>
        )}
      </AnimatePresence>

    </div>
  );
}


/** Lets the user pick an earlier run of the same handle to compare against. */
function CompareBar({ options, selected, onSelect }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap",
                    alignItems: "center" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.textDim }}>
          Compare with an earlier run
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.slice(0, 5).map((o) => {
            const active = selected?.id === o.id;
            const when = new Date(o.searched_at).toLocaleDateString(undefined,
              { day: "numeric", month: "short" });
            return (
              <button
                key={o.id}
                onClick={() => onSelect(active ? null : o)}
                style={{
                  padding: "7px 13px", borderRadius: 8, cursor: "pointer",
                  fontFamily: font.sans, fontSize: 13, fontWeight: 600,
                  background: active ? T.surfaceHi : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  color: active ? T.text : T.textDim,
                }}
              >
                {when}
              </button>
            );
          })}
        </div>
        {options.length === 0 && (
          <span style={{ fontSize: 13, color: T.textFaint }}>
            Run this again in a few days to see your progress.
          </span>
        )}
      </div>
    </Card>
  );
}



/* ── Landing state: stats + history ──────────────────────────────────────── */

/** Averages a run's stored per-topic scores into one overall number, the same
 *  way the results view does, so the history agrees with what was shown. */
function runScore(h) {
  const vals = Object.values(h?.scores || {})
    .map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Headline numbers across everything the user has run. The page had all of
 *  this in memory and was showing none of it. */
function HistoryStats({ history }) {
  const scored = history.map(runScore).filter((v) => v !== null);
  const handles = new Set(history.map((h) => String(h.cf_handle).toLowerCase()));

  // Movement between the two most recent scored runs of the same handle.
  let delta = null;
  const byHandle = {};
  for (const h of history) {
    const k = String(h.cf_handle).toLowerCase();
    (byHandle[k] ||= []).push(h);
  }
  for (const runs of Object.values(byHandle)) {
    const s = runs.map(runScore).filter((v) => v !== null);
    if (s.length >= 2) { delta = s[0] - s[1]; break; }
  }

  const items = [
    { icon: "bolt",   tone: T.accent, value: history.length, label: "analyses run" },
    { icon: "search", tone: T.violet, value: handles.size,   label: "handles studied" },
    { icon: "radar",  tone: T.cyan,
      value: scored.length ? Math.round(scored.reduce((a,b)=>a+b,0)/scored.length) : "—",
      label: "average score" },
    { icon: "trend",  tone: delta === null ? T.textFaint : delta >= 0 ? T.good : T.risk,
      value: delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta}`,
      label: "since last run" },
  ];

  return (
    <div style={{
      display: "grid", gap: 1, overflow: "hidden",
      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      borderRadius: T.radius, background: T.border,
      border: `1px solid ${T.border}`,
    }}>
      {items.map((s, i) => (
        <m.div
          key={s.label}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.06 }}
          style={{ background: T.surface, padding: "18px 18px" }}
        >
          <span style={{ color: s.tone, display: "block", marginBottom: 10 }}>
            <Icon name={s.icon} size={17} strokeWidth={1.8} />
          </span>
          <div style={{ fontFamily: font.mono, fontSize: 24, fontWeight: 820,
                        letterSpacing: -0.8, lineHeight: 1, color: s.tone }}>
            {s.value}
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>
            {s.label}
          </div>
        </m.div>
      ))}
    </div>
  );
}

function RecentRuns({ history, onOpen, loadingId }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10,
                    padding: "17px 20px", borderBottom: `1px solid ${T.border}` }}>
        <IconTile name="clock" color={T.textDim} size={28} iconSize={14} />
        <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>Recent runs</h3>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.textFaint }}>
          Click any run to reopen it
        </span>
      </div>

      <div>
        {history.slice(0, 8).map((h, i) => {
          const score = runScore(h);
          const b = score === null ? null : band(score);
          return (
            <m.button
              key={h.id}
              onClick={() => onOpen(h)}
              disabled={loadingId === h.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.32 }}
              whileHover={{ backgroundColor: T.bgAlt }}
              style={{
                display: "grid", width: "100%", textAlign: "left",
                gridTemplateColumns: "34px minmax(0,1.3fr) 1fr 74px 78px",
                alignItems: "center", gap: 13,
                padding: "13px 20px", cursor: "pointer",
                background: "transparent", color: T.text,
                border: "none", borderTop: i ? `1px solid ${T.border}` : "none",
                fontFamily: font.sans,
                opacity: loadingId === h.id ? 0.5 : 1,
              }}
            >
              {/* score ring, or a dash when the run predates stored scores */}
              <ScoreDot score={score} tone={b?.color} />

              <span style={{ display: "flex", flexDirection: "column", gap: 3,
                             overflow: "hidden" }}>
                <span style={{ fontWeight: 650, fontSize: 14, overflow: "hidden",
                               textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.cf_handle}
                </span>
                <span style={{ fontSize: 11.5, color: T.textFaint }}>
                  {new Date(h.searched_at).toLocaleDateString(undefined,
                    { day: "numeric", month: "short" })}
                  {h.cf_rating ? ` · rated ${h.cf_rating}` : ""}
                </span>
              </span>

              {h.weakest_tag ? (
                <span style={{ display: "flex", alignItems: "center", gap: 7,
                               minWidth: 0 }}>
                  <Icon name="target" size={13} color={T.risk} />
                  <span style={{ fontSize: 12.5, color: T.textDim,
                                 overflow: "hidden", textOverflow: "ellipsis",
                                 whiteSpace: "nowrap" }}>
                    {tagInfo(h.weakest_tag).name}
                  </span>
                </span>
              ) : <span />}

              {b ? (
                <Badge color={b.color} style={{ fontSize: 10.5 }}>{b.label}</Badge>
              ) : <span />}

              <span style={{ display: "flex", alignItems: "center", gap: 6,
                             justifyContent: "flex-end", fontSize: 12,
                             color: T.textFaint }}>
                {loadingId === h.id ? "Opening…" : "Open"}
                <Icon name="arrowRight" size={12} />
              </span>
            </m.button>
          );
        })}
      </div>
    </Card>
  );
}

/** A small ring showing the run's overall score at a glance. */
function ScoreDot({ score, tone }) {
  if (score === null) {
    return (
      <span style={{ width: 34, height: 34, borderRadius: 999,
                     display: "grid", placeItems: "center",
                     border: `1px dashed ${T.border}`, color: T.textFaint,
                     fontSize: 12, fontFamily: font.mono }}>
        –
      </span>
    );
  }
  const r = 15, c = 2 * Math.PI * r;
  return (
    <span style={{ position: "relative", width: 34, height: 34, display: "block" }}>
      <svg width="34" height="34" viewBox="0 0 34 34" style={{ display: "block" }}>
        <circle cx="17" cy="17" r={r} fill="none" stroke={T.border} strokeWidth="2.5" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={tone} strokeWidth="2.5"
                strokeLinecap="round" strokeDasharray={c}
                strokeDashoffset={c * (1 - score / 100)}
                transform="rotate(-90 17 17)" />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        fontFamily: font.mono, fontSize: 11.5, fontWeight: 700, color: tone,
      }}>
        {score}
      </span>
    </span>
  );
}

/** Shown before the first run, so the page is never an empty grey box. */
function FirstRunHint() {
  const steps = [
    { icon: "user",   tone: T.accent, t: "We read your full submission history" },
    { icon: "users",  tone: T.violet, t: "Match you to competitors who solve like you" },
    { icon: "target", tone: T.good,   t: "Rank your gaps and pick problems" },
  ];
  return (
    <Card style={{ padding: 26 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 5px" }}>
        Your first analysis
      </h3>
      <p style={{ color: T.textDim, fontSize: 13.5, margin: "0 0 20px" }}>
        About thirty seconds. Here is what happens.
      </p>
      <div style={{ display: "grid", gap: 11 }}>
        {steps.map((s, i) => (
          <m.div
            key={s.t}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.09, duration: 0.35 }}
            style={{ display: "flex", alignItems: "center", gap: 13,
                     padding: "12px 14px", borderRadius: T.radiusSm,
                     background: T.bgAlt, border: `1px solid ${T.border}` }}
          >
            <IconTile name={s.icon} color={s.tone} size={30} iconSize={15} />
            <span style={{ fontSize: 13.5, color: T.textDim }}>{s.t}</span>
          </m.div>
        ))}
      </div>
    </Card>
  );
}

/** Analysing a handle that is not the linked one. Metered: once every 3 months
 *  on free, once a week on Plus. The remaining wait is shown up front rather
 *  than only on refusal, so nobody types a handle and then learns it is
 *  locked. */
function OtherHandle({ limits, busy, clockBad, onRun }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const { show } = useUpgrade();
  const { beta } = useBeta();

  // The server is the authority. Absent limits (admins) mean no meter.
  if (!limits) return null;
  const locked = !limits.allowed;
  const isPlus = limits.plan === "pro";
  const cadence = isPlus ? "once a week" : "once every 3 months";

  return (
    <div style={{ marginTop: 18, paddingTop: 16,
                  borderTop: `1px solid ${T.border}` }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 9, width: "100%",
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontFamily: font.sans, color: T.textDim, textAlign: "left",
        }}
      >
        <span style={{ color: locked ? T.textFaint : T.accent, display: "flex" }}>
          <Icon name={locked ? "lock" : "search"} size={15} strokeWidth={1.8} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 620, color: T.text }}>
          Analyse another handle
        </span>
        <span style={{ fontSize: 12, color: T.textFaint }}>
          {locked
            ? `available ${limits.days_remaining <= 1 ? "tomorrow"
                : `in ${limits.days_remaining} days`}`
            : `${cadence} — available now`}
        </span>
        <span style={{ marginLeft: "auto", color: T.textFaint, display: "flex",
                       transform: open ? "rotate(180deg)" : "none",
                       transition: "transform .18s" }}>
          <Icon name="chevron" size={15} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ paddingTop: 14 }}>
              {locked ? (
                <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.65 }}>
                  You have used this month&rsquo;s allowance. Runs on your own
                  handle are still unlimited.
                  {!isPlus && !beta && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={show}
                        style={{
                          background: "none", border: "none", padding: 0,
                          cursor: "pointer", font: "inherit",
                          color: T.accent, fontWeight: 650,
                        }}
                      >
                        Plus raises this to once a week.
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <form
                    onSubmit={(e) => { e.preventDefault(); onRun(value); }}
                    style={{ display: "flex", gap: 11, flexWrap: "wrap" }}
                  >
                    <Input
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="Codeforces handle"
                      style={{ flex: 1, minWidth: 200 }}
                      disabled={busy}
                      aria-label="Another Codeforces handle"
                    />
                    <Button type="submit" loading={busy}
                            disabled={busy || !value.trim() || clockBad}>
                      Analyse
                    </Button>
                  </form>
                  <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 9,
                                lineHeight: 1.6 }}>
                    This uses your one run per {isPlus ? "week" : "3 months"}.
                    {!isPlus && !beta && " Plus raises it to one per week."}
                  </div>
                </>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
