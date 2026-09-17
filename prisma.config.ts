// Prisma 7+ configuration
// Connection URLs moved here from schema.prisma
import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { resolveMigrationDatasource } from "./lib/db/prisma-migration-identity";

// Load .env.local first, then .env
config({ path: ".env.local" });
config();

// Runtime (lib/db/prisma.ts) reads DATABASE_URL from env directly, so the app
// keeps whatever pooling mode that URL declares; this file only shapes the CLI.
//
// DIRECT_URL, when present, IS the migration connection — verbatim, and even
// when DATABASE_URL is a Supabase pooler application URL. See
// lib/db/prisma-migration-identity.ts for why the old pooler-first branch was
// an identity defect rather than a convenience.
const migration = resolveMigrationDatasource(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migration.url,
    directUrl: migration.directUrl,
  } as { url?: string; directUrl?: string },
});
