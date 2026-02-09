// Prisma 7+ configuration
// Connection URLs moved here from schema.prisma
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first, then .env
config({ path: ".env.local" });
config();

// Use placeholder so prisma generate succeeds on Vercel when env is not yet loaded (build uses real DATABASE_URL at runtime)
const databaseUrl = process.env["DATABASE_URL"] || "postgresql://placeholder:placeholder@localhost:5432/placeholder";
const directUrl = process.env["DIRECT_URL"] || databaseUrl;

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
