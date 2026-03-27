#!/usr/bin/env node
/**
 * Build script for Vercel.
 * Migrations are NOT run here — Vercel build servers can't reliably reach
 * the DB (IPv6 ENETUNREACH). Run migrations manually via:
 *   npx prisma migrate deploy
 * or via a separate migration step outside of the build pipeline.
 */
import { execSync } from "child_process"

execSync("prisma generate", { stdio: "inherit" })
execSync("next build", { stdio: "inherit" })
