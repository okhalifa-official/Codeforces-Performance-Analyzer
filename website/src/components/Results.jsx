import { useMemo, lazy, Suspense } from "react";
import { m } from "framer-motion";

// Code-split: the chart library is ~318 KB and is only needed once a user has
// actually run an analysis. Loading it on the landing page made first paint
// roughly 2s slower on a mobile connection.
const SkillRadar = lazy(() => import("./SkillRadar.jsx"));
import { T, band, font } from "../lib/theme.js";
import { tagInfo, METRICS, weakestHeadline } from "../lib/copy.js";
import { Card, Badge, Info, fadeUp } from "./ui.jsx";
import Problems from "./Problems.jsx";
import Peers from "./Peers.jsx";
import Coach from "./Coach.jsx";
import { useBeta } from "../lib/beta.jsx";
import { IconTile } from "./Icon.jsx";

/* Normalize whatever the pipeline returns into a flat [{key,name,score}] list.
   The backend has carried a few shapes over time, so be forgiving here. */
function useTags(data) {
  return useMemo(() => {
    const raw = data?.tag_strengths || {};
    const rows = Object.entries(raw).map(([key, v]) => {
      // The pipeline returns {strength: 0-100, ...} per tag. Older/other shapes
      // used user_strength or score, and some paths emit a bare 0-1 float, so
      // accept all of them rather than silently scoring everything zero.
      let score = typeof v === "number"
        ? v
        : (v?.strength ?? v?.user_strength ?? v?.score ?? 0);
      score = Number(score) || 0;
      if (score > 0 && score <= 1.0001) score *= 100;   // 0–1 float form
      const attempted = typeof v === "object" ? Number(v?.attempted ?? 0) : 0;
      const solved    = typeof v === "object" ? Number(v?.solved ?? 0) : 0;
      return {
        key, ...tagInfo(key),
        score: Math.max(0, Math.min(100, score)),
        attempted, solved,
        // A topic you have never opened is not a weakness, it is a blank.
        untouched: attempted === 0,
      };
    });
    return rows.sort((a, b) => a.score - b.score);
  }, [data]);
}

export default function Results({ data, handle, userRating, isPro, onUpgrade, isAdmin}) {
  const tags = useTags(data);
  const { beta } = useBeta();
  if (!tags.length) return null;

  // "Where to spend your next sessions" must rank real weaknesses first.
  // Sorting on score alone always surfaced untouched advanced topics: a
  // 1020-rated user was told to prioritise max-flow over dynamic programming
  // purely because they had never opened it. Topics with actual attempts come
  // first; untouched ones are offered afterwards as something new to start.
  const attemptedTags = tags.filter((t) => !t.untouched);
  const untouchedTags = tags.filter((t) => t.untouched);
  const weakest = [...attemptedTags, ...untouchedTags].slice(0, 4);
  const strongest = [...tags].reverse().slice(0, 3);
  const avg = tags.reduce((s, t) => s + t.score, 0) / tags.length;

  const problems = data?.recommended_problems || [];

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <Headline handle={handle} weakest={weakest[0]} avg={avg} />

      <div style={{
        display: "grid", gap: 22,
        gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
      }}>
        <FocusList tags={weakest} />
        <ShapeCard tags={tags} />
      </div>

      <StrengthsRow tags={strongest} />
      <AllTopics tags={tags} />
      {problems.length > 0 && (
        <Problems problems={problems} userRating={userRating}
                  isPro={isPro} onUpgrade={onUpgrade} />
      )}

      {/* No AI Coach in the beta: the API refuses it and there is nothing
          to unlock. */}
      {!beta && (
        <Coach data={data} handle={handle} isPro={isPro} isAdmin={isAdmin}
               onUpgrade={onUpgrade} />
      )}

      <Peers peers={data?.peers} isPro={isPro} onUpgrade={onUpgrade} />
    </div>
  );
}

function Headline({ handle, weakest, avg }) {
  const b = band(avg);
  return (
    <Card style={{ padding: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20,
                    alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ fontSize: 12, color: T.textFaint, letterSpacing: 1,
                        textTransform: "uppercase", marginBottom: 8,
                        display: "flex", gap: 8, alignItems: "center" }}>
            Your focus right now
            {handle && (
              <span style={{ color: T.textDim, letterSpacing: 0,
                             textTransform: "none", fontFamily: font.mono }}>
                · {handle}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 26, lineHeight: 1.25, margin: 0,
                       fontWeight: 700, letterSpacing: -0.4 }}>
            {weakest ? weakestHeadline(weakest.key) : "Your profile looks balanced."}
          </h2>
          <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.65,
                      margin: "12px 0 0", maxWidth: 560 }}>
            {weakest?.why || "Keep pushing difficulty in the topics you already enjoy."}
          </p>
        </div>
        <div style={{ textAlign: "center", minWidth: 130 }}>
          <div style={{
            fontSize: 52, fontWeight: 800, color: b.color,
            fontFamily: font.mono, lineHeight: 1, letterSpacing: -2,
          }}>
            {Math.round(avg)}
          </div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 8,
                        display: "flex", gap: 6, justifyContent: "center",
                        alignItems: "center" }}>
            Overall · {b.label}
            <Info text={METRICS.score.long} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function FocusList({ tags }) {
  return (
    <Card>
      <CardTitle
        title="Where to spend your next sessions" icon="target" tone={T.risk}
        info={METRICS.score.long}
      />
      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {tags.map((t, i) => {
          const b = band(t.score);
          return (
            <m.div
              key={t.key} custom={i} variants={fadeUp}
              initial="hidden" animate="visible"
            >
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "baseline", marginBottom: 6, gap: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 650, fontSize: 15 }}>{t.name}</span>
                  {t.untouched && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
                      padding: "2px 7px", borderRadius: 999, color: T.textDim,
                      background: T.bgAlt, border: `1px solid ${T.border}`,
                      textTransform: "uppercase",
                    }}>
                      not started
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: font.mono, fontSize: 13,
                               color: t.untouched ? T.textFaint : b.color,
                               fontWeight: 700 }}>
                  {t.untouched ? "—" : Math.round(t.score)}
                </span>
              </div>
              <div style={{ height: 7, background: T.bgAlt, borderRadius: 999,
                            overflow: "hidden" }}>
                <m.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: t.score / 100 }}
                  transition={{ duration: 0.9, delay: 0.1 + i * 0.08,
                                ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: "100%", width: "100%", borderRadius: 999,
                           transformOrigin: "left center",
                           background: `linear-gradient(90deg, ${b.color}99, ${b.color})` }}
                />
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 7,
                            lineHeight: 1.5 }}>
                {t.untouched && (
                  <span style={{ color: T.textDim }}>
                    You have not attempted this yet.{" "}
                  </span>
                )}
                {t.blurb}
              </div>
            </m.div>
          );
        })}
      </div>
    </Card>
  );
}

function ShapeCard({ tags }) {
  // Show the eight most informative topics so the shape stays readable.
  const shown = useMemo(() => {
    const sorted = [...tags].sort((a, b) => a.score - b.score);
    const picked = [...sorted.slice(0, 5), ...sorted.slice(-3)];
    return picked.map((t) => ({ tag: t.name, score: Math.round(t.score) }));
  }, [tags]);

  return (
    <Card>
      <CardTitle
        title="The shape of your skills" icon="chart" tone={T.violet}
        info="A quick read on where you are even, and where one topic lags behind the rest. Balanced profiles tend to climb more steadily."
      />
      <div style={{ height: 290, marginTop: 10 }}>
        <Suspense fallback={
          <div style={{ height: "100%", display: "grid", placeItems: "center",
                        color: T.textFaint, fontSize: 13 }}>
            Drawing your profile…
          </div>
        }>
          <SkillRadar data={shown} />
        </Suspense>
      </div>
    </Card>
  );
}

function StrengthsRow({ tags }) {
  return (
    <Card>
      <CardTitle
        title="What you are already good at" icon="shield" tone={T.good}
        info="Keep these sharp, but they are not where your next rating points come from."
      />
      <div style={{ display: "grid", gap: 12, marginTop: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {tags.map((t) => {
          const b = band(t.score);
          return (
            <div key={t.key} style={{
              padding: 16, borderRadius: T.radiusSm,
              background: T.bgAlt, border: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 650, fontSize: 14.5 }}>{t.name}</span>
                <Badge color={b.color}>{Math.round(t.score)}</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, lineHeight: 1.5 }}>
                {t.blurb}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AllTopics({ tags }) {
  const ordered = [...tags].sort((a, b) => {
    if (a.untouched !== b.untouched) return a.untouched ? 1 : -1;
    return b.score - a.score;
  });
  return (
    <Card>
      <CardTitle
        title="Every topic, scored" icon="radar" tone={T.accent}
        info={METRICS.score.long}
      />
      <div style={{ display: "grid", gap: 9, marginTop: 16 }}>
        {ordered.map((t, i) => {
          const b = band(t.score);
          return (
            <m.div
              key={t.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.35 }}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(140px, 1.3fr) 1fr auto",
                alignItems: "center", gap: 14,
                padding: "10px 12px", borderRadius: 9,
                background: i % 2 ? "transparent" : T.bgAlt + "80",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 550,
                             color: t.untouched ? T.textDim : T.text }}>
                {t.name}
              </span>
              <div style={{ height: 5, background: T.bgAlt, borderRadius: 999 }}>
                {!t.untouched && (
                  <m.div
                    initial={{ scaleX: 0 }} animate={{ scaleX: t.score / 100 }}
                    transition={{ duration: 0.7, delay: 0.15 + Math.min(i * 0.02, 0.3) }}
                    style={{ height: "100%", width: "100%", background: b.color,
                             borderRadius: 999, transformOrigin: "left center" }}
                  />
                )}
              </div>
              <span style={{
                fontFamily: font.mono, fontSize: 12.5,
                color: t.untouched ? T.textFaint : b.color,
                fontWeight: 700, minWidth: 58, textAlign: "right",
              }}>
                {/* A topic never attempted has no score to report. Showing
                    "0 · Needs work" read as a failure rather than a blank. */}
                {t.untouched ? "not started" : `${Math.round(t.score)} · ${b.label}`}
              </span>
            </m.div>
          );
        })}
      </div>
    </Card>
  );
}

function CardTitle({ title, info, icon, tone }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {icon && <IconTile name={icon} color={tone} size={30} iconSize={15} />}
      <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>{title}</h3>
      {info && <Info text={info} />}
    </div>
  );
}
