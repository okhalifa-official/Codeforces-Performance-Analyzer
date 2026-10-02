import { useState, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { METRICS } from "../lib/copy.js";
import { Card, Badge, Info, Button } from "./ui.jsx";
import Icon from "./Icon.jsx";
import {
  normalize, withLabels, selectHeadline, applyFilters, availableTopics, SORTS,
} from "../lib/problems.js";
import { useBeta } from "../lib/beta.jsx";
import { Dropdown, RangeField, ClearChip } from "./Controls.jsx";

const TONE = {
  priority: T.accent,
  common:   T.cyan,
  easy:     T.good,
  mid:      T.warn,
  hard:     T.risk,
  weakness: T.violet,
};

export default function Problems({ problems, userRating, isPro, onUpgrade }) {
  const [sort, setSort] = useState("priority");
  const [topic, setTopic] = useState("");
  const [range, setRange] = useState({ min: "", max: "" });
  const [expanded, setExpanded] = useState(false);
  // In the beta nobody has Pro, so the locked sort/filter button and the
  // "show more" upsell would only point at something that cannot be bought.
  const { beta } = useBeta();

  const all = useMemo(
    () => withLabels((problems || []).map(normalize), userRating),
    [problems, userRating]
  );

  const topics = useMemo(() => availableTopics(all), [all]);

  // Free accounts always see the curated headline set. Pro accounts get the
  // full list plus sorting and filtering.
  const shown = useMemo(() => {
    if (!isPro) return selectHeadline(all, 12);
    let list = applyFilters(all, {
      topic,
      minRating: Number(range.min) || 0,
      maxRating: Number(range.max) || 0,
    });
    list = [...list].sort(SORTS[sort].fn);
    return expanded ? list : list.slice(0, 12);
  }, [all, isPro, sort, topic, range, expanded]);

  const remaining = isPro
    ? Math.max(0, applyFilters(all, {
        topic,
        minRating: Number(range.min) || 0,
        maxRating: Number(range.max) || 0,
      }).length - shown.length)
    : Math.max(0, all.length - shown.length);

  if (!all.length) return null;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>
            Practise these next
          </h3>
          <Info text={METRICS.priority.long} />
        </div>
        <Controls
          isPro={isPro} beta={beta} onUpgrade={onUpgrade}
          sort={sort} setSort={setSort}
          topic={topic} setTopic={setTopic}
          topics={topics} range={range} setRange={setRange}
        />
      </div>

      {isPro && (topic || range.min || range.max) && shown.length === 0 && (
        <div style={{ padding: "28px 4px", color: T.textDim, fontSize: 14 }}>
          No problems match those filters. Try widening the rating range.
        </div>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 18,
                    gridTemplateColumns: "repeat(auto-fit, minmax(268px, 1fr))" }}>
        <AnimatePresence mode="popLayout">
          {shown.map((p, i) => (
            <ProblemCard key={p.key} p={p} i={i} />
          ))}
        </AnimatePresence>
      </div>

      {remaining > 0 && (isPro || !beta) && (
        <MoreButton
          count={remaining} isPro={isPro} expanded={expanded}
          onExpand={() => setExpanded(true)} onUpgrade={onUpgrade}
        />
      )}
    </Card>
  );
}

function ProblemCard({ p, i }) {
  return (
    <m.a
      layout
      href={p.url || undefined}
      target="_blank" rel="noopener noreferrer"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.32 }}
      whileHover={{ y: -3, borderColor: T.accent }}
      style={{
        display: "block", padding: 15, borderRadius: T.radiusSm,
        background: T.bgAlt, border: `1px solid ${T.border}`,
        textDecoration: "none", color: "inherit",
        cursor: p.url ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between",
                    gap: 10, alignItems: "flex-start", marginBottom: 9 }}>
        <span style={{ fontWeight: 650, fontSize: 14.5, lineHeight: 1.35 }}>
          {p.name}
        </span>
        {p.rating ? (
          <span style={{
            fontFamily: font.mono, fontSize: 12, fontWeight: 700,
            color: T.textDim, whiteSpace: "nowrap",
          }}>{p.rating}</span>
        ) : null}
      </div>

      {p.labels.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 9 }}>
          {p.labels.slice(0, 3).map((l) => (
            <Badge key={l.id} color={TONE[l.tone] || T.textFaint}
                   style={{ fontSize: 10.5, padding: "2px 7px" }}>
              {l.text}
            </Badge>
          ))}
        </div>
      )}

      {p.tagNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {p.tagNames.slice(0, 3).map((t) => (
            <span key={t} style={{
              fontSize: 11, color: T.textFaint, padding: "2px 7px",
              border: `1px solid ${T.border}`, borderRadius: 6,
            }}>{t}</span>
          ))}
        </div>
      )}
    </m.a>
  );
}

function Controls({ isPro, beta, onUpgrade, sort, setSort, topic, setTopic, topics,
                    range, setRange }) {
  if (!isPro && beta) return null;
  if (!isPro) {
    return (
      <button onClick={onUpgrade} style={{
        display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
        padding: "9px 13px", borderRadius: T.radiusSm, fontFamily: font.sans,
        fontSize: 12.5, fontWeight: 600, color: T.textDim,
        background: "transparent", border: `1px dashed ${T.borderHi}`,
      }}>
        <Icon name="lock" size={13} /> Sort and filter with Pro
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Dropdown
        label="Sort problems" value={sort} onChange={setSort} minWidth={158}
        options={Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v.label }))}
      />
      <Dropdown
        label="Filter by topic" value={topic} onChange={setTopic} minWidth={166}
        options={[
          { value: "", label: "All topics" },
          ...topics.map((t) => ({ value: t.key, label: t.name, hint: t.count })),
        ]}
      />
      <RangeField
        min={range.min} max={range.max}
        onChange={setRange}
        presets={[
          { label: "Below my level", min: "", max: "1200" },
          { label: "Around my level", min: "1200", max: "1800" },
          { label: "Above my level", min: "1800", max: "" },
          { label: "Any rating", min: "", max: "" },
        ]}
      />
    </div>
  );
}

function MoreButton({ count, isPro, expanded, onExpand, onUpgrade }) {
  if (isPro) {
    if (expanded) return null;
    return (
      <div style={{ marginTop: 18, textAlign: "center" }}>
        <Button variant="subtle" onClick={onExpand}>
          Show {count} more problem{count === 1 ? "" : "s"}
        </Button>
      </div>
    );
  }
  return (
    <m.button
      onClick={onUpgrade}
      whileHover={{ y: -2 }}
      style={{
        width: "100%", marginTop: 18, padding: "16px 20px",
        borderRadius: T.radiusSm, cursor: "pointer", textAlign: "left",
        fontFamily: font.sans,
        background: `linear-gradient(135deg, ${T.accent}12, ${T.violet}12)`,
        border: `1px dashed ${T.accent}55`,
        display: "flex", alignItems: "center", gap: 14,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        display: "grid", placeItems: "center",
        background: `${T.accent}1a`, border: `1px solid ${T.accent}44`,
      }}>
        <Icon name="lock" size={15} color={T.accent} />
      </div>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>
          Show {count} more problem{count === 1 ? "" : "s"}
        </div>
        <div style={{ fontSize: 12.5, color: T.textDim, marginTop: 3 }}>
          The full list, plus sorting and filtering, are part of Pro.
        </div>
      </div>
      <Badge color={T.violet} style={{ marginLeft: "auto" }}>Pro</Badge>
    </m.button>
  );
}

