# Email Setup (GoDaddy, SendGrid, Postmark, or AWS SES)

Overtaxed uses **nodemailer** with SMTP. Configure any provider that supports SMTP.

## GoDaddy (overtaxed-il.com)

If you use **GoDaddy** for domain + email (e.g. `support@overtaxed-il.com`):

1. **Create** the email account in GoDaddy (My Products → Domains → overtaxed-il.com → Email). Use a **main mailbox**, not an alias — SMTP auth fails with aliases.
2. **SMTP:** `smtpout.secureserver.net`, port **465** (SSL) or 587 (TLS). User = full email, password = mailbox password.
3. **Vercel:** Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in Environment Variables, then **Redeploy**.
4. **Enable SMTP auth** in GoDaddy Workspace if not already on (often off by default).

Full steps (Vercel + GoDaddy URL + GoDaddy email): **`docs/OVERTAXED_VERCEL_GODADDY.md`** (Parts 2–3 for domain, **Part 5** for email). See **LESSONS_LEARNED.md §32** for troubleshooting.

---

## Environment Variables

Add to `.env.local`:

```env
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT="587"
SMTP_USER="apikey"
SMTP_PASSWORD="your-sendgrid-api-key"
SMTP_FROM="noreply@yourdomain.com"
```

## SendGrid

1. Sign up at [sendgrid.com](https://sendgrid.com).
2. **Settings → API Keys** → Create API Key (Restricted, Mail Send).
3. Use:
   - `SMTP_HOST=smtp.sendgrid.net`
   - `SMTP_PORT=587`
   - `SMTP_USER=apikey`
   - `SMTP_PASSWORD=<your API key>`
   - `SMTP_FROM` = verified sender (e.g. `noreply@yourdomain.com`).

## Postmark

1. Sign up at [postmarkapp.com](https://postmarkapp.com).
2. **Servers → [your server] → API Tokens** → Generate.
3. Use:
   - `SMTP_HOST=smtp.postmarkapp.com`
   - `SMTP_PORT=587`
   - `SMTP_USER=<your API token>`
   - `SMTP_PASSWORD=<same API token>`
   - `SMTP_FROM` = verified sender.

## AWS SES

1. Configure SES in AWS (verify domain or email).
2. Create SMTP credentials (SES → SMTP settings).
3. Use:
   - `SMTP_HOST=email-smtp.<region>.amazonaws.com`
   - `SMTP_PORT=587`
   - `SMTP_USER` / `SMTP_PASSWORD` = SES SMTP credentials.
   - `SMTP_FROM` = verified identity.

## Verification

- **`lib/email/config.ts`** exposes `isEmailConfigured()`. If SMTP vars are missing, `sendEmail()` logs a warning and skips sending.
- **Cron** `GET /api/cron/deadline-reminders` sends appeal deadline emails. Ensure `CRON_SECRET` is set when using Vercel Cron or an external scheduler.
