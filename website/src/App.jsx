import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { m, LazyMotion, domAnimation } from "framer-motion";
import { AuthProvider, useAuth } from "./lib/auth.jsx";
import { T, font } from "./lib/theme.js";
import Logo from "./components/Logo.jsx";
import Icon from "./components/Icon.jsx";
import { BetaProvider, useBeta } from "./lib/beta.jsx";
import { UpgradeProvider, useUpgrade } from "./lib/upgrade.jsx";
import UpgradeGate from "./components/UpgradeGate.jsx";
import Footer from "./components/Footer.jsx";
import { Button, Spinner } from "./components/ui.jsx";
import { lazy, Suspense } from "react";
import Landing from "./pages/Landing.jsx";

// Route-level code splitting. A first-time visitor lands on the marketing page
// and should not download the admin table, the profile forms or the results
// view to see it. Landing stays eager because it IS the first paint.
const Login     = lazy(() => import("./pages/Auth.jsx").then(m => ({ default: m.Login })));
const Signup    = lazy(() => import("./pages/Auth.jsx").then(m => ({ default: m.Signup })));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Profile   = lazy(() => import("./pages/Profile.jsx"));
const Admin     = lazy(() => import("./pages/Admin.jsx"));
const BetaWaitlist = lazy(() => import("./pages/BetaWaitlist.jsx"));
const Terms     = lazy(() => import("./pages/Terms.jsx"));
const ForgotPassword = lazy(() =>
  import("./pages/Recover.jsx").then(m => ({ default: m.ForgotPassword })));
const ResetPassword  = lazy(() =>
  import("./pages/Recover.jsx").then(m => ({ default: m.ResetPassword })));

function PageFallback() {
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <Spinner size={22} color={T.accent} />
    </div>
  );
}

export default function App() {
  return (
    <BetaProvider>
    <AuthProvider>
      {/* LazyMotion + the lightweight `m` component keep the animation engine
          out of the initial bundle: it is fetched once, in parallel, instead of
          blocking first paint. */}
      <LazyMotion features={domAnimation} strict>
        <UpgradeProvider>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </UpgradeProvider>
      </LazyMotion>
    </AuthProvider>
    </BetaProvider>
  );
}

/** A waitlisted account (past the beta's account cap) has nothing to use. The
 *  flag only means anything while the beta is on, so it is ignored otherwise. */
function useWaitlisted() {
  const { user } = useAuth();
  const { beta } = useBeta();
  return Boolean(beta && user?.beta_waitlisted);
}

function Shell() {
  const { ready } = useAuth();
  // Hold the first paint for the beta flag too, so nobody sees Plus UI flash
  // up and then disappear (or the reverse).
  const { loaded: betaLoaded } = useBeta();
  if (!ready || !betaLoaded) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                    background: T.bg }}>
        <Spinner size={26} color={T.accent} />
      </div>
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
                  fontFamily: font.sans,
                  display: "flex", flexDirection: "column" }}>
      <Nav />
      <div style={{ flex: 1 }}>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login"  element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
        <Route path="/terms" element={<Terms />} />
        {/* Reachable while signed out, which is the whole point of them. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
        <Route path="/profile"   element={<Private><Profile /></Private>} />
        <Route path="/admin"     element={<AdminOnly><Admin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </div>
      <Footer />
      <GlobalUpgradeGate />
    </div>
  );
}

function GlobalUpgradeGate() {
  const { open, hide } = useUpgrade();
  const { beta } = useBeta();
  // No Plus in the beta, so no upsell modal and nothing that opens checkout.
  if (beta) return null;
  // No onUpgrade handler: checkout now opens inside the gate itself, so
  // closing here would dismiss the panel the moment the user commits.
  return <UpgradeGate open={open} onClose={hide} />;
}

function HomeRoute() {
  const { user, accountsEnabled } = useAuth();
  if (!accountsEnabled) return <Navigate to="/dashboard" replace />;
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  return <Landing />;
}

function Private({ children }) {
  const { user, accountsEnabled } = useAuth();
  const waitlisted = useWaitlisted();
  const loc = useLocation();
  // When the deployment has no database, accounts are switched off entirely
  // and the analyzer stays usable anonymously. Guarding here would otherwise
  // lock everyone out of the only working page.
  if (!accountsEnabled) return children;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  // Past the beta cap: every signed-in page is this one screen, so there is no
  // route a waitlisted account can reach that shows the analyzer.
  if (waitlisted) return <BetaWaitlist />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  // Non-admins are sent away rather than shown a refusal, matching the API,
  // which 404s the admin surface for them.
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  return children;
}

function Nav() {
  const { user, logout, isAdmin, accountsEnabled } = useAuth();
  const { beta } = useBeta();
  const waitlisted = useWaitlisted();
  const loc = useLocation();
  const link = (to, label) => (
    <Link key={to} to={to} style={{
      fontSize: 14, fontWeight: 600, textDecoration: "none", padding: "7px 12px",
      borderRadius: 8, color: loc.pathname === to ? T.text : T.textDim,
      background: loc.pathname === to ? T.surfaceHi : "transparent",
    }}>{label}</Link>
  );

  return (
    <m.header
      initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      style={{
        position: "sticky", top: 0, zIndex: 100,
        borderBottom: `1px solid ${T.border}`,
        background: `${T.bg}e8`, backdropFilter: "blur(12px)",
      }}
    >
      <div style={{
        maxWidth: 1240, margin: "0 auto", padding: "13px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center",
                              textDecoration: "none", color: T.text }}>
          <Logo size={28} textSize={16} />
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!accountsEnabled ? null : waitlisted ? (
            // The waitlist screen carries its own sign-out; there is nothing
            // else for this account to navigate to.
            null
          ) : user ? (
            <>
              {link("/dashboard", "Analyse")}
              {isAdmin && link("/admin", "Admin")}
              {link("/profile", "Profile")}
              {!beta && user.plan !== "pro" && <PlusButton />}
              <Button size="sm" variant="ghost" onClick={logout}
                      style={{ marginLeft: 6 }}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/login"><Button size="sm" variant="ghost">Sign in</Button></Link>
              <Link to="/signup"><Button size="sm">Get started</Button></Link>
            </>
          )}
        </nav>
      </div>
    </m.header>
  );
}

/** Nav button opening the Plus screen. Shown only to accounts that are not
 *  already on Plus — selling someone what they have is just noise. */
function PlusButton() {
  const { show } = useUpgrade();
  return (
    <m.button
      onClick={show}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      aria-label="See what Plus includes"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "7px 13px", marginLeft: 4, borderRadius: 8,
        cursor: "pointer", fontFamily: font.sans,
        fontSize: 13.5, fontWeight: 650, color: T.text,
        background: `linear-gradient(135deg, ${T.accent}26, ${T.violet}26)`,
        border: `1px solid ${T.accent}55`,
        position: "relative", overflow: "hidden",
      }}
    >
      {/* A slow sheen, so the button reads as the one premium affordance in
          the bar without resorting to a constant pulse. */}
      <m.span
        aria-hidden
        animate={{ x: ["-130%", "180%"] }}
        transition={{ duration: 3.4, repeat: Infinity, repeatDelay: 3.2,
                      ease: "easeInOut" }}
        style={{
          position: "absolute", top: 0, bottom: 0, width: "40%",
          background: `linear-gradient(100deg, transparent, ${T.text}1f, transparent)`,
          pointerEvents: "none",
        }}
      />
      <span style={{ color: T.violet, display: "flex" }}>
        <Icon name="diamond" size={14} strokeWidth={1.9} />
      </span>
      Plus
    </m.button>
  );
}
