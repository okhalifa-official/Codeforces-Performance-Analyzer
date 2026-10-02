// Postgres pool shared by the auth and admin routes.
//
// The web service runs inside Railway, so it uses the PRIVATE DATABASE_URL
// (postgres.railway.internal). That host does not resolve outside Railway,
// which is why CI uses DATABASE_PUBLIC_URL instead.

import pg from "pg";
import { ensureBetaSchema } from "../services/beta.js";

const { Pool } = pg;

let pool = null;

export function databaseUrl() {
  const priv = (process.env.DATABASE_URL || "").trim();
  const pub  = (process.env.DATABASE_PUBLIC_URL || "").trim();

  // postgres.railway.internal only resolves inside Railway's own network.
  // `railway run` injects that private URL (and the RAILWAY_* vars) into a
  // process running on a laptop, where it fails with ENOTFOUND — so those
  // vars cannot be used to tell "deployed" from "local" apart.
  //
  // RAILWAY_PRIVATE_DOMAIN is set only in a deployed container, which makes it
  // a reliable signal. When we are not deployed and a public URL exists,
  // prefer it.
  const deployed = Boolean(process.env.RAILWAY_PRIVATE_DOMAIN);
  const privateHost = /\.railway\.internal/.test(priv);

  if (privateHost && !deployed && pub) return pub;
  return priv || pub;
}

export function dbEnabled() {
  return databaseUrl().length > 0;
}

export function getPool() {
  if (pool) return pool;
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — accounts are unavailable");
  }
  pool = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Railway's public proxy terminates TLS with a cert the default trust
    // store does not chain to. The private host is inside their network.
    ssl: /proxy\.rlwy\.net|\.railway\.app/.test(connectionString)
      ? { rejectUnauthorized: false }
      : false,
  });
  pool.on("error", (err) => console.error("pg pool error:", err.message));
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

/** Apply the app schema. Idempotent — safe on every boot. */
export async function ensureSchema() {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, "schema.sql"), "utf8");
  await query(sql);
  // Adds accounts.beta_waitlisted and backfills it once; see services/beta.js
  // for why this is not a plain ADD COLUMN IF NOT EXISTS in schema.sql.
  await ensureBetaSchema(getPool());
}
