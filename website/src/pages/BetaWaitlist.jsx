import { m } from "framer-motion";
import { T } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { useBeta } from "../lib/beta.jsx";
import { Button, Card, Badge } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";
import Icon, { IconTile } from "../components/Icon.jsx";

/** Everything a waitlisted account sees. The product is in a closed beta for
 *  the first accounts; later ones are created normally but have nothing to use
 *  yet, so this screen replaces the whole signed-in app rather than hiding
 *  pieces of it. No analysis input, no dashboard, no navigation. */
export default function BetaWaitlist() {
  const { user, logout } = useAuth();
  const { maxAccounts } = useBeta();

  return (
    <div style={{ position: "relative", minHeight: "calc(100vh - 66px)",
                  display: "grid", placeItems: "center", padding: "48px 20px" }}>
      <Aurora intensity={0.55} />
      <m.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 480, position: "relative", zIndex: 1 }}
      >
        <Card style={{ padding: 34, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center",
                        marginBottom: 20 }}>
            <IconTile name="check" color={T.good} size={52} iconSize={26} />
          </div>

          <h1 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 10px",
                       letterSpacing: -0.5, lineHeight: 1.2 }}>
            Your account was created successfully
          </h1>
          <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.65,
                      margin: "0 0 22px" }}>
            Codeforces Performance Analyzer is in a limited beta, open to the
            first {maxAccounts} accounts. You signed up after those places were
            taken, so the analyzer isn&rsquo;t available to you yet.
          </p>

          <div style={{
            display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left",
            padding: "14px 16px", borderRadius: T.radiusSm, marginBottom: 24,
            background: T.bgAlt, border: `1px solid ${T.border}`,
          }}>
            <span style={{ color: T.accent, marginTop: 2, display: "flex" }}>
              <Icon name="clock" size={17} strokeWidth={1.8} />
            </span>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6,
                        color: T.textDim }}>
              We&rsquo;ll email you at{" "}
              <strong style={{ color: T.text, wordBreak: "break-all" }}>
                {user?.email}
              </strong>{" "}
              as soon as the system is released. There is nothing else you
              need to do.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "center",
                        marginBottom: 20 }}>
            <Badge color={T.violet}>Beta</Badge>
          </div>

          <Button variant="ghost" onClick={logout} style={{ width: "100%" }}>
            Sign out
          </Button>
        </Card>
      </m.div>
    </div>
  );
}
