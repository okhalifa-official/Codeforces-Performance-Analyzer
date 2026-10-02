import { useState, useEffect, useRef } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import { useBeta } from "../lib/beta.jsx";

/* A portrait showcase of what the product does, built from the same tokens and
 * motion as the rest of the page rather than from a recorded video.
 *
 * Why not an <video>: a scaled recording renders text softer than the live
 * text beside it, which is the exact cue that reads as "embedded". This is the
 * real UI, so it stays crisp at any size, costs a few KB instead of megabytes,
 * and changes when the design does.
 *
 * The loop is four beats telling one story: type a handle, see every topic
 * scored, find the weak one, get problems and a plan. */

const SCENE_MS = 3600;

const TOPICS = [
  { name: "Implementation", score: 89, tone: T.good },
  { name: "Greedy",         score: 74, tone: T.cyan },
  { name: "Binary search",  score: 61, tone: T.cyan },
  { name: "Dynamic prog.",  score: 41, tone: T.warn },
  { name: "Graphs",         score: 28, tone: T.risk },
];

const PROBLEMS = [
  { id: "1352_G", rating: 1500, tag: "graphs" },
  { id: "580_C",  rating: 1500, tag: "trees"  },
  { id: "893_C",  rating: 1400, tag: "dsu"    },
];

const DAYS = [
  { n: 1, topic: "Graphs", done: true  },
  { n: 2, topic: "Graphs", done: true  },
  { n: 3, topic: "DP",     done: false },
];

export default function ProductLoop() {
  const [scene, setScene] = useState(0);
  const [reduced, setReduced] = useState(false);
  const timer = useRef(null);
  // The final beat is the AI Coach's weekly plan, which the beta omits.
  const { beta } = useBeta();
  const scenes = beta ? 3 : 4;

  // A looping animation is exactly what someone disables motion to avoid, so
  // honour the preference by holding the final, most informative beat.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    if (reduced) return;   // no timer at all when motion is off
    timer.current = setInterval(
      () => setScene((s) => (s + 1) % scenes), SCENE_MS);
    return () => clearInterval(timer.current);
  }, [reduced, scenes]);

  // Derived, not stored: with motion off the last beat is the one worth
  // holding, and deriving it avoids a state write during an effect.
  const active = reduced ? scenes - 1 : scene;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 300,
                  margin: "0 auto" }}>
      {/* Glow behind the frame, so the card sits in the page rather than on
          top of it. */}
      <div aria-hidden style={{
        position: "absolute", inset: "-14% -22%", borderRadius: "50%",
        background: `radial-gradient(closest-side, ${T.accent}1f, transparent 72%)`,
        filter: "blur(22px)", pointerEvents: "none",
      }} />

      <div style={{
        position: "relative", aspectRatio: "9 / 14", overflow: "hidden",
        borderRadius: 20, background: T.surface,
        border: `1px solid ${T.borderHi}`,
        boxShadow: "0 30px 80px rgba(0,0,0,.55)",
        display: "flex", flexDirection: "column",
      }}>
        <Chrome />

        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <AnimatePresence mode="wait">
            <m.div
              key={active}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              style={{ position: "absolute", inset: 0, padding: "14px 16px",
                       display: "flex", flexDirection: "column" }}
            >
              {active === 0 && <SceneHandle />}
              {active === 1 && <SceneScores />}
              {active === 2 && <SceneProblems />}
              {active === 3 && <ScenePlan />}
            </m.div>
          </AnimatePresence>
        </div>

        {!reduced && <Progress scene={active} count={scenes} />}
      </div>
    </div>
  );
}

/* ── frame ───────────────────────────────────────────────────────────────── */

function Chrome() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7,
                  padding: "11px 14px",
                  borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      {[T.risk, T.warn, T.good].map((c) => (
        <span key={c} style={{ width: 7, height: 7, borderRadius: 999,
                               background: `${c}66` }} />
      ))}
      <span style={{ marginLeft: 6, fontSize: 10.5, color: T.textFaint,
                     fontFamily: font.mono, letterSpacing: 0.3 }}>
        cfanalyzer
      </span>
    </div>
  );
}

/** Which beat is playing. Reads as a story with four parts rather than a
 *  video that happens to restart. */
function Progress({ scene, count }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "0 16px 14px",
                  flexShrink: 0 }}>
      {Array.from({ length: count }, (_, i) => i).map((i) => (
        <div key={i} style={{ flex: 1, height: 2.5, borderRadius: 999,
                              background: T.bgAlt, overflow: "hidden" }}>
          {i === scene && (
            <m.div
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
              transition={{ duration: SCENE_MS / 1000, ease: "linear" }}
              style={{ height: "100%", background: T.accent,
                       transformOrigin: "left center" }}
            />
          )}
          {i < scene && (
            <div style={{ height: "100%", background: `${T.accent}55` }} />
          )}
        </div>
      ))}
    </div>
  );
}

function Caption({ children }) {
  return (
    <div style={{ fontSize: 10.5, letterSpacing: 0.7, color: T.textFaint,
                  textTransform: "uppercase", marginBottom: 12,
                  flexShrink: 0 }}>
      {children}
    </div>
  );
}

/* ── beat 1: a handle goes in ────────────────────────────────────────────── */

function SceneHandle() {
  const text = "tourist";
  const [n, setN] = useState(0);

  useEffect(() => {
    // Typed one character at a time. setInterval rather than a CSS animation
    // so the caret and the text stay in step.
    const id = setInterval(
      () => setN((v) => (v >= text.length ? v : v + 1)), 130);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <Caption>Start with a handle</Caption>
      <div style={{ display: "flex", alignItems: "center", gap: 9,
                    padding: "11px 13px", borderRadius: T.radiusSm,
                    background: T.bgAlt, border: `1px solid ${T.borderHi}` }}>
        <span style={{ color: T.textFaint, display: "flex" }}>
          <Icon name="search" size={14} />
        </span>
        <span style={{ fontFamily: font.mono, fontSize: 14, color: T.text }}>
          {text.slice(0, n)}
          <m.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            style={{ color: T.accent }}
          >|</m.span>
        </span>
      </div>

      <m.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1.3 }}
        style={{ marginTop: 16, display: "grid", gap: 9, alignContent: "start",
                 flex: 1 }}
      >
        {["Reading your submissions",
          "Matching you to similar players",
          "Scoring every topic"].map((line, i) => (
          <m.div
            key={line}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.5 + i * 0.35 }}
            style={{ display: "flex", alignItems: "center", gap: 8,
                     fontSize: 11.5, color: T.textDim }}
          >
            <span style={{ color: T.good, display: "flex" }}>
              <Icon name="check" size={11} strokeWidth={2.4} />
            </span>
            {line}
          </m.div>
        ))}
      </m.div>
    </>
  );
}

/* ── beat 2: every topic scored ──────────────────────────────────────────── */

function SceneScores() {
  return (
    <>
      <Caption>Every topic, scored</Caption>
      <div style={{ display: "grid", gap: 10, alignContent: "center",
                    flex: 1 }}>
        {TOPICS.map((t, i) => (
          <div key={t.name}>
            <div style={{ display: "flex", justifyContent: "space-between",
                          marginBottom: 5 }}>
              <span style={{ fontSize: 11.5, color: T.textDim }}>{t.name}</span>
              <m.span
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.5 + i * 0.12 }}
                style={{ fontFamily: font.mono, fontSize: 11.5,
                         color: t.tone, fontWeight: 700 }}
              >
                {t.score}
              </m.span>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: T.bgAlt }}>
              <m.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: t.score / 100 }}
                transition={{ duration: 0.8, delay: 0.25 + i * 0.12,
                              ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%", borderRadius: 999, background: t.tone,
                         transformOrigin: "left center" }}
              />
            </div>
          </div>
        ))}
      </div>

      <m.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5 }}
        style={{ marginTop: "auto", paddingTop: 14, fontSize: 10.5,
                 color: T.textFaint, lineHeight: 1.5 }}
      >
        Benchmarked against rated competitors, not against everyone.
      </m.div>
    </>
  );
}

/* ── beat 3: problems worth solving ──────────────────────────────────────── */

function SceneProblems() {
  return (
    <>
      <Caption>Problems picked for you</Caption>

      <m.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        style={{ padding: "11px 13px", borderRadius: T.radiusSm,
                 background: `${T.risk}12`, border: `1px solid ${T.risk}33`,
                 marginBottom: 13 }}
      >
        <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 3 }}>
          Weakest topic
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>
          Graphs · <span style={{ color: T.risk, fontFamily: font.mono }}>28</span>
        </div>
      </m.div>

      <div style={{ display: "grid", gap: 8, alignContent: "center", flex: 1 }}>
        {PROBLEMS.map((p, i) => (
          <m.div
            key={p.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.45 + i * 0.2 }}
            style={{ display: "flex", alignItems: "center", gap: 9,
                     padding: "9px 11px", borderRadius: 9,
                     background: T.bgAlt, border: `1px solid ${T.border}` }}
          >
            <span style={{ fontFamily: font.mono, fontSize: 11.5,
                           color: T.accent }}>{p.id}</span>
            <span style={{ fontSize: 10.5, color: T.textFaint }}>{p.tag}</span>
            <span style={{ marginLeft: "auto", fontFamily: font.mono,
                           fontSize: 11, color: T.textDim }}>{p.rating}</span>
          </m.div>
        ))}
      </div>
    </>
  );
}

/* ── beat 4: a plan to follow ────────────────────────────────────────────── */

function ScenePlan() {
  return (
    <>
      <Caption>A week you can follow</Caption>

      <div style={{ display: "grid", gap: 8, alignContent: "center", flex: 1 }}>
        {DAYS.map((d, i) => (
          <m.div
            key={d.n}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.18 }}
            style={{ display: "flex", alignItems: "center", gap: 10,
                     padding: "10px 12px", borderRadius: 9,
                     background: T.bgAlt, border: `1px solid ${T.border}` }}
          >
            <m.span
              initial={false}
              animate={{
                background: d.done ? T.good : "transparent",
                borderColor: d.done ? T.good : T.borderHi,
              }}
              transition={{ delay: 0.9 + i * 0.25 }}
              style={{ width: 15, height: 15, borderRadius: 5,
                       border: "1.5px solid", display: "grid",
                       placeItems: "center", flexShrink: 0 }}
            >
              {d.done && (
                <m.span
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ delay: 1 + i * 0.25 }}
                  style={{ color: T.bg, display: "flex" }}
                >
                  <Icon name="check" size={9} strokeWidth={3.4} />
                </m.span>
              )}
            </m.span>
            <span style={{ fontFamily: font.mono, fontSize: 10.5,
                           color: T.violet }}>DAY {d.n}</span>
            <span style={{ fontSize: 12, color: T.textDim }}>{d.topic}</span>
          </m.div>
        ))}
      </div>

      <m.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1.6 }}
        style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8,
                 fontSize: 11, color: T.textFaint }}
      >
        <span style={{ color: T.violet, display: "flex" }}>
          <Icon name="sparkle" size={12} />
        </span>
        Warm-up, a resource and a check, every day
      </m.div>
    </>
  );
}
