#!/usr/bin/env node
/** Retry prisma migrate deploy - P1002 advisory lock timeout is often transient on Vercel/Supabase */
import { execSync } from "child_process"
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      execSync("prisma migrate deploy", { stdio: "inherit" })
      break
    } catch (e) {
      if (i < MAX_RETRIES) {
        console.log(`Migration timed out, retrying in ${RETRY_DELAY_MS / 1000}s (${i}/${MAX_RETRIES})...`)
        await sleep(RETRY_DELAY_MS)
      } else {
        process.exit(1)
      }
    }
  }
  execSync("prisma generate", { stdio: "inherit" })
  execSync("next build", { stdio: "inherit" })
})()
