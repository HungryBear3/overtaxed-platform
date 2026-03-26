# PRD: OverTaxed IL — Resend Drip Email Sequences

## Goal
Migrate OT email from nodemailer/SMTP to Resend, then build automated drip email sequences for township alert subscribers.

## Context
- `lib/email/transport.ts` — currently nodemailer (SMTP). Replace with Resend.
- `lib/email/send.ts` — calls `getMailer()` from transport. Update to use Resend SDK.
- `lib/email/index.ts`, `lib/email/templates.ts`, `lib/email/config.ts` — check and update as needed.
- `app/api/township-alert/route.ts` — saves TownshipAlert records. Hook drip enrollment here.
- `prisma/schema.prisma` — needs DripEmail model added.
- `RESEND_API_KEY` is already set in Vercel env (Production + Preview).
- No SMTP env vars are set in production — nodemailer is already broken in prod.

## Working Directory
`/Users/abigailclaw/overtaxed-platform` (branch: main)

## Tasks

### 1. Install Resend SDK
```bash
npm install resend
```

### 2. Create Resend client
File: `lib/email/resend.ts`
```ts
import { Resend } from "resend"

if (!process.env.RESEND_API_KEY) {
  console.warn("[resend] RESEND_API_KEY not set – emails disabled")
}

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

export const FROM_EMAIL = "OverTaxed IL <support@overtaxed-il.com>"
```

### 3. Replace transport.ts with Resend
Update `lib/email/transport.ts` to re-export from resend.ts (or replace inline).
Update `lib/email/send.ts` to use Resend instead of nodemailer.
The `sendEmail({ to, subject, html, text })` signature must stay the same.

Keep all existing sendXxx functions in `send.ts` working — just swap the transport.

### 4. Add DripEmail model to Prisma schema
Add to `prisma/schema.prisma`:
```prisma
model DripEmail {
  id           String   @id @default(cuid())
  email        String
  sequence     String   // "ot-township"
  step         Int      // 1-5
  scheduledFor DateTime
  sentAt       DateTime?
  createdAt    DateTime @default(now())

  @@index([scheduledFor, sentAt])
  @@index([email, sequence])
}
```

Run migration:
```bash
npx prisma migrate dev --name add_drip_email
```

### 5. Create drip enrollment utility
File: `lib/drip.ts`

Function `enrollInDrip(email: string, sequence: string)` that:
- Creates DripEmail records for each step
- "ot-township" sequence: 5 emails at day 0, 3, 7, 14, 30
- Skips if already enrolled (check for existing records with same email + sequence)

### 6. Hook drip enrollment into township alert signup
In `app/api/township-alert/route.ts`:
- After successfully saving a TownshipAlert, call `enrollInDrip(email, "ot-township")`

### 7. Create drip send API route
File: `app/api/drip/send/route.ts`

A cron-triggered route that:
- Queries DripEmail records where `scheduledFor <= now()` and `sentAt IS NULL`
- Sends each email via Resend
- Marks `sentAt` on success
- Handles errors gracefully (log, don't crash loop)

Protect with: `Authorization: Bearer ${process.env.CRON_SECRET}` header check.

### 8. Email content for ot-township sequence
Step 1 (day 0 — immediate): Subject: "You're on the list — here's what happens next"
  - Explain: we'll email when their township's appeal window opens
  - Plug: free check tool at overtaxed-il.com

Step 2 (day 3): Subject: "Most Cook County homeowners overpay by $1,200/year — are you one of them?"
  - Stats on how many assessments are wrong
  - CTA: run your free check at overtaxed-il.com

Step 3 (day 7): Subject: "Property tax appeal: what it actually costs (and what you keep)"
  - Break down attorney fees (33-40%) vs OverTaxed IL flat fee
  - CTA: see our pricing

Step 4 (day 14): Subject: "Your township's appeal window is coming — don't miss it"
  - Urgency: windows are 30-90 days and don't come back for a year
  - CTA: make sure your check is already done

Step 5 (day 30): Subject: "Last reminder before your appeal window closes"
  - Final push: file now or wait another year
  - CTA: start your appeal at overtaxed-il.com

### 9. Build and verify
Run: `npm run build`
Fix any TypeScript errors.

## Constraints
- Use Resend SDK only — remove nodemailer dependency from email send path
- Keep existing sendXxx function signatures intact
- Don't break contact form, billing emails, or any other existing email flows
- No other new npm dependencies beyond `resend`

## Completion
1. Commit: `feat: Migrate to Resend + drip email sequences for OT township alerts`
2. Push: `git push origin main`
3. Run: `openclaw system event --text "Done: OT Resend migration + drip sequences built" --mode now`
