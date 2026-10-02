import { m } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { Card, Badge, Info } from "./ui.jsx";
import Icon from "./Icon.jsx";
import { useBeta } from "../lib/beta.jsx";

/** The ten users the model matched you against. Pro only.
 *
 *  This is the panel that makes the scores legible: every topic score is
 *  measured against these people, so seeing who they are explains why a
 *  score moved. */
export default function Peers({ peers, isPro, onUpgrade }) {
  const { beta } = useBeta();
  // A blurred preview with an upgrade button is a sales surface; with no Plus
  // to sell in the beta it is hidden outright.
  if (!peers?.length || (beta && !isPro)) return null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>
          Who you were compared with
        </h3>
        <Info text="Your scores are relative to these ten users — the closest matches to your solving profile out of 28,000. A topic score of 60 means you are ahead of roughly 60% of them on that topic." />
        {!isPro && <Badge color={T.violet} style={{ marginLeft: "auto" }}>Pro</Badge>}
      </div>
      <p style={{ color: T.textDim, fontSize: 13.5, margin: "0 0 16px" }}>
        The closest matches to your solving profile. Every topic score is
        measured against them.
      </p>

      <div style={{ position: "relative" }}>
        <div style={{ display: "grid", gap: 6 }}>
          {peers.slice(0, 10).map((p, i) => (
            <PeerRow key={p.handle} p={p} i={i} blurred={!isPro} />
          ))}
        </div>

        {!isPro && (
          <div style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center",
            background: `linear-gradient(180deg, ${T.surface}22 0%, ${T.surface}dd 55%, ${T.surface} 100%)`,
          }}>
            <m.button
              onClick={onUpgrade}
              whileHover={{ y: -2 }}
              style={{
                display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                padding: "13px 20px", borderRadius: T.radiusSm,
                fontFamily: font.sans, fontSize: 13.5, fontWeight: 650,
                color: T.text, background: T.surfaceHi,
                border: `1px solid ${T.accent}66`,
                boxShadow: "0 12px 30px rgba(0,0,0,.45)",
              }}
            >
              <Icon name="lock" size={13} color={T.accent} /> See your ten closest peers with Pro
            </m.button>
          </div>
        )}
      </div>
    </Card>
  );
}

function PeerRow({ p, i, blurred }) {
  return (
    <m.div
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(i * 0.04, 0.35), duration: 0.3 }}
      style={{
        display: "grid", alignItems: "center", gap: 12,
        gridTemplateColumns: "26px minmax(0,1fr) 92px 72px 62px",
        padding: "10px 13px", borderRadius: T.radiusSm,
        background: i % 2 ? "transparent" : T.bgAlt + "80",
        filter: blurred ? "blur(5px)" : "none",
        userSelect: blurred ? "none" : "auto",
      }}
    >
      <span style={{
        fontFamily: font.mono, fontSize: 12, fontWeight: 700,
        color: i < 3 ? T.accent : T.textFaint,
      }}>
        {p.rank}
      </span>

      {blurred ? (
        <span style={{ fontWeight: 600, fontSize: 14 }}>••••••••••</span>
      ) : (
        <a
          href={`https://codeforces.com/profile/${encodeURIComponent(p.handle)}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            fontWeight: 600, fontSize: 14, color: T.text,
            textDecoration: "none", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = T.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = T.text)}
        >
          {p.handle}
        </a>
      )}

      <SimilarityBar value={p.similarity} />

      <span style={{ fontFamily: font.mono, fontSize: 12, color: T.textDim,
                     textAlign: "right" }}>
        {p.solved} solved
      </span>

      <span style={{ fontFamily: font.mono, fontSize: 12, textAlign: "right",
                     color: p.rating ? T.textDim : T.textFaint }}>
        {p.rating ?? "—"}
      </span>
    </m.div>
  );
}

function SimilarityBar({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: T.bgAlt, borderRadius: 999 }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 999,
          background: `linear-gradient(90deg, ${T.accent}, ${T.violet})`,
        }} />
      </div>
      <span style={{ fontFamily: font.mono, fontSize: 11.5, color: T.textFaint,
                     minWidth: 30, textAlign: "right" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

