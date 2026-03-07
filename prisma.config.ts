// Prisma 7+ configuration
// Connection URLs moved here from schema.prisma
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first, then .env
config({ path: ".env.local" });
config();

// Use placeholder so prisma generate succeeds on Vercel when env is not yet loaded (build uses real DATABASE_URL at runtime)
let databaseUrl = process.env["DATABASE_URL"] || "postgresql://placeholder:placeholder@localhost:5432/placeholder";
// Supabase pooler (port 6543 = Transaction mode) requires pgbouncer=true for Prisma Client
if (databaseUrl.includes("pooler.supabase.com") && !databaseUrl.includes("pgbouncer=true")) {
  databaseUrl += (databaseUrl.includes("?") ? "&" : "?") + "pgbouncer=true";
}

// Prisma 7 uses `url` for migrate deploy (not directUrl). Use Session mode pooler (port 5432) for migrations
// to avoid "prepared statement already exists" and firewall blocks on direct connection.
// Runtime (lib/db/prisma.ts) uses DATABASE_URL from env directly, so app keeps Transaction mode (6543).
let migrateUrl: string;
let directUrl: string;
if (databaseUrl.includes("pooler.supabase.com")) {
  // Session mode pooler: port 5432, pgbouncer=true for migrate deploy
  migrateUrl = databaseUrl.replace(/:6543\//, ":5432/");
  if (!migrateUrl.includes("pgbouncer=true")) {
    migrateUrl += (migrateUrl.includes("?") ? "&" : "?") + "pgbouncer=true";
  }
  directUrl = migrateUrl;
} else if (process.env["DIRECT_URL"]) {
  migrateUrl = process.env["DIRECT_URL"];
  directUrl = migrateUrl;
} else {
  migrateUrl = databaseUrl;
  directUrl = databaseUrl;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrateUrl,
    directUrl,
  } as { url?: string; directUrl?: string },
});
