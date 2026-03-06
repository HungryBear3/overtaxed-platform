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
// Migrations: use Session mode pooler (port 5432 on pooler host) - supports prepared statements, IPv4-compatible.
// Avoids "prepared statement already exists" (Transaction mode) and IPv4 add-on cost (direct connection).
// We use pooler for migrations; ignore DIRECT_URL since direct is IPv6-only.
let directUrl: string;
if (databaseUrl.includes("pooler.supabase.com")) {
  directUrl = databaseUrl.replace(/:6543\//, ":5432/").replace(/\?pgbouncer=true&?|\&?pgbouncer=true/g, "");
} else {
  directUrl = process.env["DIRECT_URL"] || databaseUrl;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
    directUrl,
  } as { url?: string; directUrl?: string },
});
