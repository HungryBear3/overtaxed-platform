# Setup: Auto Checks & Notifications for User PINs

Follow these steps to get automated checks and email notifications running.

---

## Step 1: Database migration (township column)

The schedule-based monitoring uses a `township` column on the `Property` table.

**In Supabase SQL Editor** (Dashboard → SQL Editor):

```sql
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "township" TEXT;
```

**Then regenerate Prisma client** (from the `overtaxed-platform` folder):

```bash
cd overtaxed-platform
npx prisma generate
```

---

## Step 2: Set CRON_SECRET

The cron endpoints require a secret to prevent unauthorized calls.

1. Generate a random string, e.g.:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Add to **Vercel** → Project → Settings → Environment Variables:
   - Name: `CRON_SECRET`
   - Value: (paste the generated string)
   - Apply to: Production, Preview (if you want to test)

Vercel Cron will send `Authorization: Bearer <CRON_SECRET>` when it invokes your cron endpoints.

---

## Step 3: Configure email (SMTP)

Notifications (deadline reminders, assessment increases) require SMTP.

1. Pick a provider: **SendGrid**, **Postmark**, **AWS SES**, or **GoDaddy** (see `docs/EMAIL_SETUP.md`).

2. Add these to **Vercel** → Environment Variables:

   | Variable | Example (SendGrid) |
   |----------|--------------------|
   | `SMTP_HOST` | `smtp.sendgrid.net` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | `apikey` |
   | `SMTP_PASSWORD` | Your SendGrid API key |
   | `SMTP_FROM` | `noreply@yourdomain.com` (must be verified) |

3. Verify your sender/domain in the provider’s dashboard.

4. Redeploy the app so the new env vars are picked up.

---

## Step 4: Set NEXT_PUBLIC_APP_URL ( Production )

Cron emails contain links like `https://yoursite.com/appeals/...`. Those come from `NEXT_PUBLIC_APP_URL`.

- In Vercel env: `NEXT_PUBLIC_APP_URL` = `https://overtaxed-il.com` (or your production URL).
- Ensure it doesn’t end with a slash.

---

## Step 5: Deploy and verify crons

1. Deploy to Vercel (e.g. push to `main` if auto-deploy is on).

2. Confirm crons exist: **Vercel** → Project → Settings → Crons. You should see:
   - `/api/cron/deadline-reminders` — daily at 9:00 UTC
   - `/api/cron/assessment-checks` — Mondays at 10:00 UTC

3. **Note:** Vercel Cron on the **Pro** plan runs crons in production. On **Hobby**, crons are limited.

---

## Step 6: Test the crons (optional)

**Manual test** (replace `YOUR_CRON_SECRET` with your actual secret):

```bash
# Test deadline reminders (no emails if no matching appeals)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://overtaxed-il.com/api/cron/deadline-reminders

# Test assessment checks (runs only Jan–Aug; outside season returns skipped)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://overtaxed-il.com/api/cron/assessment-checks
```

Expected: `200` with JSON like `{"success": true, "emailsSent": 0}` or `{"success": true, "skipped": true, ...}`.

---

## What runs when

| Cron | When | What it does |
|------|------|--------------|
| **Deadline reminders** | Daily 9:00 UTC | Emails users with DRAFT/PENDING_FILING appeals whose deadline is in 7, 3, or 1 days |
| **Assessment checks** | Mondays 10:00 UTC | Jan–Aug only; checks monitored properties in townships with active appeal windows; emails on assessment increase |

---

## Checklist

- [ ] `township` column added to `Property`
- [ ] `npx prisma generate` run
- [ ] `CRON_SECRET` set in Vercel
- [ ] SMTP vars set (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`)
- [ ] `NEXT_PUBLIC_APP_URL` set to production URL
- [ ] App deployed
- [ ] Crons visible in Vercel dashboard
- [ ] (Optional) Manual curl test of cron endpoints
