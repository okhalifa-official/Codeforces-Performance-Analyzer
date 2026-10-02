import { useState, useEffect } from "react";
import { m } from "framer-motion";
import { Link } from "react-router-dom";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { useBeta } from "../lib/beta.jsx";
import { Button, Card, Badge } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";
import ProductLoop from "../components/ProductLoop.jsx";
import Icon, { IconTile } from "../components/Icon.jsx";

const PLUS_PRICE = 399;          // EGP per month

export default function Landing() {
  // Real number from the deployed model, so the page never overstates itself.
  const [trainingUsers, setTrainingUsers] = useState(null);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    api.mlVersion?.()
      .then((v) => { if (alive && v?.training_users) setTrainingUsers(v.training_users); })
      .catch(() => { /* the page reads fine without it */ });
    api.siteStats?.()
      .then((s2) => { if (alive && s2?.peers) setStats(s2); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <Hero trainingUsers={trainingUsers} />
      <StatsBand stats={stats} trainingUsers={trainingUsers} />
      <HowItWorks />
      <InAction />
      <Features />
      <WeeklyModel trainingUsers={trainingUsers} />
      <Pricing />
      <FinalCta />
      <Disclaimer />
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero({ trainingUsers }) {
  const { beta, maxAccounts } = useBeta();
  return (
    <section style={{
      position: "relative", overflow: "hidden",
      padding: "clamp(72px, 12vw, 128px) 24px clamp(64px, 9vw, 104px)",
      textAlign: "center",
    }}>
      <Aurora />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 880, margin: "0 auto" }}>
        <m.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 9,
            padding: "6px 14px", borderRadius: 999, marginBottom: 26,
            background: T.surface, border: `1px solid ${T.border}`,
            fontSize: 12.5, color: T.textDim,
          }}
        >
          {beta && <Badge color={T.violet}>Beta</Badge>}
          <Pulse />
          Retrained every week
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.04 }}
          style={{ display: "flex", alignItems: "center", gap: 11,
                   justifyContent: "center", marginBottom: 20 }}
        >
          <span style={{
            fontSize: "clamp(13px, 1.8vw, 15px)", fontWeight: 650,
            letterSpacing: 2.4, textTransform: "uppercase", color: T.textDim,
          }}>
            Codeforces Performance Analyzer
          </span>
        </m.div>

        <m.h1
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06 }}
          style={{
            fontSize: "clamp(34px, 6.2vw, 62px)", fontWeight: 800,
            letterSpacing: -1.8, lineHeight: 1.06, margin: "0 0 20px",
          }}
        >
          Stop guessing what to
          <br />
          practise next.
        </m.h1>

        <m.p
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.13 }}
          style={{
            fontSize: "clamp(16px, 2.1vw, 19px)", color: T.textDim,
            lineHeight: 1.65, maxWidth: 620, margin: "0 auto 34px",
          }}
        >
          Your Codeforces history, scored against competitors who solve like
          you — and the exact problems to open next.
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          style={{ display: "flex", gap: 12, justifyContent: "center",
                   flexWrap: "wrap", marginBottom: 18 }}
        >
          <Link to="/signup" style={{ textDecoration: "none" }}>
            <Button size="lg">Analyse my profile — free</Button>
          </Link>
          <Link to="/login" style={{ textDecoration: "none" }}>
            <Button size="lg" variant="ghost">Sign in</Button>
          </Link>
        </m.div>

        <m.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.32 }}
          style={{ fontSize: 13, color: T.textFaint, margin: 0 }}
        >
          {beta
            ? `Free during the beta, limited to the first ${maxAccounts} accounts. No card needed.`
            : "Free forever. No card needed. Just your handle."}
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          style={{ marginTop: 56 }}
        >
          <HeroPreview trainingUsers={trainingUsers} />
        </m.div>
      </div>
    </section>
  );
}

/** A small, honest mock of the real result view. */
function HeroPreview({ trainingUsers }) {
  const rows = [
    { name: "Implementation", score: 89, tone: T.good },
    { name: "Greedy",         score: 74, tone: T.cyan },
    { name: "Dynamic Programming", score: 41, tone: T.warn },
    { name: "Graphs",         score: 28, tone: T.risk },
  ];
  return (
    <Card style={{ maxWidth: 680, margin: "0 auto", textAlign: "left",
                   padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "baseline", marginBottom: 18, gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.7, color: T.textFaint,
                        textTransform: "uppercase", marginBottom: 5 }}>
            Your focus right now
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            Graphs is where you have the most to gain.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: T.warn,
                        fontFamily: font.mono, lineHeight: 1 }}>58</div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>Overall</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 11 }}>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: "grid",
                gridTemplateColumns: "minmax(120px,1fr) 2fr 34px",
                alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 550 }}>{r.name}</span>
            <div style={{ height: 5, background: T.bgAlt, borderRadius: 999 }}>
              <m.div
                initial={{ scaleX: 0 }} animate={{ scaleX: r.score / 100 }}
                transition={{ duration: 0.9, delay: 0.55 + i * 0.1,
                              ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%", width: "100%", borderRadius: 999,
                         background: r.tone, transformOrigin: "left center" }}
              />
            </div>
            <span style={{ fontFamily: font.mono, fontSize: 12,
                           color: r.tone, fontWeight: 700, textAlign: "right" }}>
              {r.score}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, paddingTop: 15,
                    borderTop: `1px solid ${T.border}`,
                    fontSize: 12, color: T.textFaint }}>
        Benchmarked against{" "}
        <strong style={{ color: T.textDim, fontFamily: font.mono }}>
          {trainingUsers ? trainingUsers.toLocaleString() : "28,000+"}
        </strong>{" "}
        rated competitors
      </div>
    </Card>
  );
}

/* ── In action ───────────────────────────────────────────────────────────── */

/** The product showing itself. Sits after "how it works" so the loop lands on
 *  someone who already knows what they are looking at, and before the feature
 *  list so it answers "what is this actually like" before the specifics. */
function InAction() {
  const { beta } = useBeta();
  // The week-long plan is the AI Coach, which the beta does not include.
  const points = [
    { icon: "search", tone: T.accent, title: "No setup",
      body: "Your public Codeforces history is all it needs. No account linking, no imports." },
    { icon: "chart", tone: T.cyan, title: "Scored against your peers",
      body: "Every topic measured against players at your rating, so a 60 means something." },
    { icon: "target", tone: T.warn, title: "Told where to start",
      body: "The one topic with the most to gain, not a list of twenty things to fix." },
    ...(beta ? [] : [
      { icon: "sparkle", tone: T.violet, title: "A week you can follow",
        body: "Specific problems, a warm-up each day, and a check you can tick off." },
    ]),
  ];
  return (
    <Section alt id="in-action">
      <SectionHead
        eyebrow="See it run"
        title="Thirty seconds, start to finish"
        sub={beta
          ? "One handle in. Every topic scored, your weakest found, and the exact problems to open next."
          : "One handle in. Every topic scored, your weakest found, and a week of practice you can actually follow."}
      />
      <div style={{
        display: "grid", gap: 40, alignItems: "center",
        // Two columns only when both genuinely fit; below that they stack,
        // or a 260 + 280 grid overflows a phone viewport.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
        maxWidth: 880, margin: "0 auto",
      }}>
        <Reveal>
          <ProductLoop />
        </Reveal>

        <Reveal delay={0.1}>
          <div style={{ display: "grid", gap: 20 }}>
            {points.map((f) => (
              <div key={f.title} style={{ display: "flex", gap: 13,
                                          alignItems: "flex-start" }}>
                <IconTile name={f.icon} color={f.tone} size={34} iconSize={16} />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 680,
                                marginBottom: 4 }}>
                    {f.title}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: T.textDim,
                              lineHeight: 1.6 }}>
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    { n: "01", icon: "user",  tone: T.accent,
      title: "Your handle",  body: "Every attempt, not just the wins." },
    { n: "02", icon: "users", tone: T.violet,
      title: "Your real peers", body: "Matched on how — and how much — you solve." },
    { n: "03", icon: "target", tone: T.good,
      title: "Your plan",    body: "Ranked gaps. Specific problems." },
  ];
  return (
    <Section>
      <SectionHead
        eyebrow="How it works"
        title="Three steps, about thirty seconds"
      />
      <div style={{ display: "grid", gap: 18,
                    gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.08}>
            <Card style={{ height: "100%", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center",
                            justifyContent: "space-between", marginBottom: 16 }}>
                <IconTile name={s.icon} color={s.tone} />
                <span style={{ fontFamily: font.mono, fontSize: 12,
                               color: T.textFaint, fontWeight: 700 }}>
                  {s.n}
                </span>
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 7px" }}>
                {s.title}
              </h3>
              <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                {s.body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Features ────────────────────────────────────────────────────────────── */

function Features() {
  const { beta } = useBeta();
  // Peer view and sorting/filtering are Plus features; the beta has no Plus.
  const betaHidden = ["users", "filter"];
  const all = [
    { icon: "radar", tone: T.accent, wide: true,
      title: "20 topics. One honest number each.",
      body: "Scored against people at your level — not an absolute grade." },
    { icon: "target", tone: T.good,
      title: "Problems chosen, not listed",
      body: "Warm-up, Stretch, Reach." },
    { icon: "users", tone: T.violet,
      title: "Meet your ten closest peers",
      body: "No black box." },
    { icon: "trend", tone: T.cyan,
      title: "Watch the gaps close",
      body: "Any two runs, side by side." },
    { icon: "filter", tone: T.warn,
      title: "Build the session you want",
      body: "By topic. By rating." },
  ];
  const items = beta ? all.filter((f) => !betaHidden.includes(f.icon)) : all;
  return (
    <Section alt>
      <SectionHead
        eyebrow="What you get"
        title="Built to answer one question"
        sub="What should I solve next, and why that?"
      />
      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        {items.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.06}
                  style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
            <Card style={{ height: "100%", padding: 24 }} hover>
              <IconTile name={f.icon} color={f.tone}
                        size={f.wide ? 46 : 38} iconSize={f.wide ? 22 : 18} />
              <h3 style={{ fontSize: f.wide ? 23 : 16.5, fontWeight: 740,
                           margin: "16px 0 8px", letterSpacing: -0.5,
                           lineHeight: 1.22 }}>
                {f.title}
              </h3>
              <p style={{ color: T.textDim, fontSize: f.wide ? 15.5 : 14,
                          lineHeight: 1.55, margin: 0,
                          maxWidth: f.wide ? 460 : undefined }}>
                {f.body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Weekly model ────────────────────────────────────────────────────────── */

function WeeklyModel({ trainingUsers }) {
  return (
    <Section>
      <Card style={{ padding: "clamp(28px, 5vw, 48px)" }}>
        <div style={{ display: "grid", gap: 34, alignItems: "center",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9,
                          marginBottom: 18 }}>
              <Pulse />
              <span style={{ fontSize: 12, letterSpacing: 0.7, color: T.textDim,
                             textTransform: "uppercase" }}>
                Retrained weekly
              </span>
            </div>
            <h2 style={{ fontSize: "clamp(23px, 3.4vw, 32px)", fontWeight: 760,
                         letterSpacing: -0.9, margin: "0 0 14px", lineHeight: 1.2 }}>
              The model does not go stale
            </h2>
            <p style={{ color: T.textDim, fontSize: 15, lineHeight: 1.65, margin: 0 }}>
              Fresh submissions, rebuilt peers, full retrain — every Sunday.
              Your scores track the Codeforces of now.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <MetricRow icon="users" tone={T.accent}
                       value={trainingUsers ? trainingUsers.toLocaleString() : "28,492"}
                       label="rated competitors" />
            <MetricRow icon="radar" tone={T.violet}
                       value="20" label="topics, every run" />
            <MetricRow icon="refresh" tone={T.good}
                       value="Weekly" label="full retrain, Sundays" />
          </div>
        </div>
      </Card>
    </Section>
  );
}

function MetricRow({ icon, tone, value, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14,
                  padding: "13px 16px", borderRadius: T.radiusSm,
                  background: T.bgAlt, border: `1px solid ${T.border}` }}>
      <IconTile name={icon} color={tone} size={32} iconSize={16} />
      <span style={{ fontFamily: font.mono, fontSize: 20, fontWeight: 800,
                     color: tone, minWidth: 84 }}>
        {value}
      </span>
      <span style={{ fontSize: 13.5, color: T.textDim }}>{label}</span>
    </div>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */

const FREE = [
  { t: "One analysis a week",        icon: "calendar" },
  { t: "12 problems",                icon: "target" },
  { t: "All 20 topics scored",       icon: "radar" },
  { t: "Another handle every 3 months", icon: "search" },
  { t: "Sorting and filtering",      no: true },
  { t: "Peer view",                  no: true },
  { t: "AI-Coach free trial",        soon: true },
];

// What the beta's single plan includes: the Free list minus the locked rows
// (which only exist to sell Plus) and the AI Coach.
const BETA_FREE = FREE.filter((f) => !f.no && !f.soon);

const PLUS = [
  { t: "One analysis every 3 days",  icon: "bolt" },
  { t: "Up to 50 problems",          icon: "target" },
  { t: "Sort and filter",            icon: "filter" },
  { t: "Your ten closest peers",     icon: "users" },
  { t: "Another handle every week",  icon: "search" },
  { t: "Compare any two runs",       icon: "trend" },
  { t: "AI-Coach early access",      soon: true },
];

function Pricing() {
  const { beta, maxAccounts } = useBeta();

  // The closed beta has one plan. Plus, its price and the AI Coach are not on
  // offer, so they are not mentioned at all rather than shown as "coming soon".
  if (beta) {
    return (
      <Section alt id="pricing">
        <SectionHead
          eyebrow="Beta"
          title="Free while we're in beta."
          sub="No card required to begin."
        />
        <div style={{ maxWidth: 420, margin: "0 auto 26px" }}>
          <Reveal>
            <PlanCard
              name="Free"
              price="0"
              period="during the beta"
              blurb="Find your weakest topic. Start fixing it."
              features={BETA_FREE}
              cta="Create a free account"
              to="/signup"
            />
          </Reveal>
        </div>
        <p style={{ textAlign: "center", color: T.textFaint, fontSize: 13,
                    lineHeight: 1.6, margin: 0 }}>
          Beta &mdash; limited to the first {maxAccounts} accounts. Sign up after
          that and we&rsquo;ll email you when the system is released.
        </p>
      </Section>
    );
  }

  return (
    <Section alt id="pricing">
      <SectionHead
        eyebrow="Pricing"
        title="Start free. Upgrade when you outgrow it."
        sub="No card required to begin."
      />
      <div style={{ display: "grid", gap: 20, alignItems: "start",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    maxWidth: 860, margin: "0 auto 26px" }}>
        <Reveal>
          <PlanCard
            name="Free"
            price="0"
            period="forever"
            blurb="Find your weakest topic. Start fixing it."
            features={FREE}
            cta="Create a free account"
            to="/signup"
          />
        </Reveal>
        <Reveal delay={0.08}>
          <PlanCard
            name="Plus"
            price={PLUS_PRICE}
            period="EGP / month"
            blurb="For the next rating band."
            features={PLUS}
            cta="Get Plus"
            to="/signup"
            highlight
          />
        </Reveal>
      </div>
    </Section>
  );
}

function PlanCard({ name, price, period, blurb, features, cta, to, highlight }) {
  return (
    <Card style={{
      height: "100%", padding: 28, position: "relative",
      border: `1px solid ${highlight ? T.accent + "66" : T.border}`,
      background: highlight
        ? `linear-gradient(180deg, ${T.accent}0a, transparent 40%), ${T.surface}`
        : T.surface,
    }}>
      {highlight && (
        <Badge color={T.accent} style={{ position: "absolute", top: 20, right: 20 }}>
          Most popular
        </Badge>
      )}
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.4,
                    textTransform: "uppercase", color: highlight ? T.accent : T.textDim,
                    marginBottom: 14 }}>
        {name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 42, fontWeight: 820, letterSpacing: -1.6,
                       fontFamily: font.mono, lineHeight: 1 }}>
          {price}
        </span>
        <span style={{ fontSize: 13.5, color: T.textFaint }}>{period}</span>
      </div>
      <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6,
                  margin: "0 0 22px", minHeight: 44 }}>
        {blurb}
      </p>

      <Link to={to} style={{ textDecoration: "none", display: "block" }}>
        <Button variant={highlight ? "primary" : "subtle"} style={{ width: "100%" }}>
          {cta}
        </Button>
      </Link>

      <div style={{ display: "grid", gap: 11, marginTop: 24 }}>
        {features.map((f) => (
          <div key={f.t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Mark no={f.no} soon={f.soon} icon={f.icon} />
            <span style={{
              fontSize: 13.5, lineHeight: 1.5,
              color: f.no ? T.textFaint : T.textDim,
              textDecoration: f.no ? "line-through" : "none",
            }}>
              {f.t}
              {f.soon && (
                <span style={{
                  marginLeft: 7, fontSize: 10.5, fontWeight: 600,
                  padding: "1px 6px", borderRadius: 999, color: T.violet,
                  background: `${T.violet}1a`, border: `1px solid ${T.violet}44`,
                  textTransform: "uppercase", letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                }}>
                  coming soon
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Mark({ no, soon, icon }) {
  // The icon carries the meaning of the line; the tick alone said only
  // "included", which every row already implies.
  const name = no ? "cross" : soon ? "clock" : (icon || "check");
  const color = no ? T.textFaint : soon ? T.violet : T.good;
  return (
    <span style={{ color, marginTop: 1 }}>
      <Icon name={name} size={15} strokeWidth={2.1} />
    </span>
  );
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section style={{ position: "relative", overflow: "hidden",
                      padding: "clamp(70px, 10vw, 110px) 24px", textAlign: "center" }}>
      <Aurora intensity={1.2} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(26px, 4.4vw, 40px)", fontWeight: 790,
                     letterSpacing: -1.2, margin: "0 0 16px", lineHeight: 1.15 }}>
          Find your weakest topic in thirty seconds
        </h2>
        <p style={{ color: T.textDim, fontSize: 16, lineHeight: 1.6,
                    margin: "0 0 30px" }}>
          One handle. One honest answer.
        </p>
        <Link to="/signup" style={{ textDecoration: "none" }}>
          <Button size="lg">Analyse my profile — free</Button>
        </Link>
      </div>
    </section>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function Section({ children, alt, id }) {
  return (
    <section id={id} style={{
      padding: "clamp(56px, 8vw, 92px) 24px",
      background: alt ? T.bgAlt : "transparent",
      borderTop: alt ? `1px solid ${T.border}` : "none",
      borderBottom: alt ? `1px solid ${T.border}` : "none",
    }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub }) {
  return (
    <Reveal>
      <div style={{ marginBottom: 38, maxWidth: 640 }}>
        <div style={{ fontSize: 12, letterSpacing: 0.9, color: T.accent,
                      textTransform: "uppercase", fontWeight: 650, marginBottom: 12 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontSize: "clamp(24px, 3.6vw, 34px)", fontWeight: 770,
                     letterSpacing: -1, margin: 0, lineHeight: 1.18 }}>
          {title}
        </h2>
        {sub && (
          <p style={{ color: T.textDim, fontSize: 15.5, lineHeight: 1.65,
                      margin: "12px 0 0" }}>
            {sub}
          </p>
        )}
      </div>
    </Reveal>
  );
}

function Reveal({ children, delay = 0, style }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay }}
      style={style}
    >
      {children}
    </m.div>
  );
}

function Pulse() {
  return (
    <span style={{ position: "relative", display: "inline-flex",
                   width: 7, height: 7, flexShrink: 0 }}>
      <m.span
        animate={{ scale: [1, 2.1, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        style={{ position: "absolute", inset: 0, borderRadius: 999,
                 background: T.good }}
      />
      <span style={{ position: "relative", width: 7, height: 7,
                     borderRadius: 999, background: T.good }} />
    </span>
  );
}

/* ── Stats band ──────────────────────────────────────────────────────────── */

/** Real figures from /api/stats, with static fallbacks so the band never
 *  renders empty if the call fails. Counting animation runs once on view. */
function StatsBand({ stats, trainingUsers }) {
  const items = [
    { icon: "users",  tone: T.accent,
      value: stats?.peers ?? trainingUsers ?? 28492,
      label: "rated competitors" },
    { icon: "layers", tone: T.violet,
      value: stats?.submissions ?? 14321151,
      label: "submissions analysed" },
    { icon: "target", tone: T.good,
      value: stats?.problems ?? 12921,
      label: "problems in the pool" },
    { icon: "radar",  tone: T.cyan,
      value: stats?.topics ?? 20,
      label: "topics scored" },
  ];
  return (
    <section style={{ padding: "0 24px", marginTop: -28, position: "relative", zIndex: 2 }}>
      <div style={{
        maxWidth: 1080, margin: "0 auto",
        display: "grid", gap: 1, overflow: "hidden",
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        borderRadius: T.radius, background: T.border,
        border: `1px solid ${T.border}`,
      }}>
        {items.map((s, i) => (
          <m.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.07 }}
            style={{ background: T.surface, padding: "22px 20px" }}
          >
            <span style={{ color: s.tone, display: "block", marginBottom: 12 }}>
              <Icon name={s.icon} size={19} strokeWidth={1.8} />
            </span>
            <div style={{ fontFamily: font.mono, fontSize: "clamp(20px, 2.6vw, 26px)",
                          fontWeight: 820, letterSpacing: -0.8, lineHeight: 1 }}>
              <CountUp to={s.value} />
            </div>
            <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 7 }}>
              {s.label}
            </div>
          </m.div>
        ))}
      </div>
    </section>
  );
}

/** Counts up once, then holds. Large numbers are abbreviated so the band
 *  stays readable: 14,321,151 reads as 14.3M. */
function CountUp({ to }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf, start;
    const dur = 1100;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      // easeOutExpo: fast then settling, which reads as "counting up".
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);

  if (to >= 1_000_000) return <>{(n / 1_000_000).toFixed(1)}M</>;
  return <>{n.toLocaleString()}</>;
}

/* ── Disclaimer ──────────────────────────────────────────────────────────── */

function Disclaimer() {
  return (
    <section style={{ padding: "0 24px 64px" }}>
      <div style={{
        maxWidth: 1080, margin: "0 auto", display: "flex", gap: 13,
        alignItems: "flex-start", padding: "16px 18px",
        borderRadius: T.radiusSm, background: T.bgAlt,
        border: `1px solid ${T.border}`,
      }}>
        <span style={{ color: T.textFaint, marginTop: 1 }}>
          <Icon name="alert" size={16} />
        </span>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: T.textFaint }}>
          <strong style={{ color: T.textDim }}>Not affiliated with Codeforces.</strong>{" "}
          This is an independent project. It is not built, endorsed or sponsored
          by Codeforces or its developers. It reads publicly available data
          through the official Codeforces API. Codeforces is a trademark of its
          respective owner.
        </p>
      </div>
    </section>
  );
}

