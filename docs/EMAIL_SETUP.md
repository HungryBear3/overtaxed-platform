# Email Setup (SendGrid, Postmark, or AWS SES)

Overtaxed uses **nodemailer** with SMTP. Configure any provider that supports SMTP.

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
