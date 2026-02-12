// Prisma 7+ configuration
// Connection URLs moved here from schema.prisma
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first, then .env
config({ path: ".env.local" });
config();

// Use placeholder so prisma generate succeeds on Vercel when env is not yet loaded (build uses real DATABASE_URL at runtime)
const rawDbUrl = process.env["DATABASE_URL"] || "postgresql://placeholder:placeholder@localhost:5432/placeholder";
const directUrlRaw = process.env["DIRECT_URL"] || rawDbUrl;

// Append connect_timeout for serverless (Vercel) to reduce "timeout exceeded when trying to connect" on cold starts
function withTimeout(url: string, seconds = 60): string {
  if (url.includes("placeholder") || url.includes("connect_timeout=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connect_timeout=${seconds}`;
}
const databaseUrl = withTimeout(rawDbUrl);
const directUrl = withTimeout(directUrlRaw, 30);

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
