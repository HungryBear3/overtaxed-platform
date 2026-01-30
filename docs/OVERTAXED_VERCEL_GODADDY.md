# Overtaxed: Vercel + GoDaddy Setup

Step-by-step guide to deploy **Overtaxed** on Vercel, connect your **overtaxed-il.com** domain via GoDaddy DNS, and use **GoDaddy email** (e.g. `support@overtaxed-il.com`) for transactional emails.

---

## Part 1: Vercel — Import and deploy

### 1.1 Import the project

1. Go to **[vercel.com/new](https://vercel.com/new)** → **Add New** → **Project**
2. **Import** **HungryBear3/overtaxed-platform**
3. **Configure:**
   - **Project Name:** `overtax-platform` (or `overtaxed-il`)
   - **Framework Preset:** Next.js (auto-detect)
   - **Root Directory:** **.** (leave default)
   - **Build Command:** `prisma generate && next build` (default)
   - **Output Directory:** `.next`
   - **Install Command:** `npm install`

### 1.2 Environment variables

**Settings** → **Environment Variables** → add these (Production; add Preview too if you use branch deploys).

Use values from **`.env.local`** or **`docs/OVERTAXED_SECRETS_AND_PRICES.md`** (placeholders only; never commit real values).

| Name | Value (first deploy) | Notes |
|------|----------------------|-------|
| `DATABASE_URL` | Supabase **pooler** URL (port 6543) | Supabase → Settings → Database |
| `DIRECT_URL` | Supabase **direct** URL (port 5432) | Same |
| `NEXTAUTH_URL` | `https://overtaxed-platform-xxx.vercel.app` | **Your Vercel project URL** — update after custom domain |
| `NEXTAUTH_SECRET` | Base64 secret | From `.env.local` or generate |
| `NEXT_PUBLIC_APP_URL` | Same as `NEXTAUTH_URL` | Update with custom domain later |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` or live | |
| `STRIPE_SECRET_KEY` | `sk_test_...` or live | |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe webhook for **this** app URL (see below) |
| `STRIPE_PRICE_COMPS_ONLY` | `price_...` | Overtaxed price IDs |
| `STRIPE_PRICE_STARTER` | `price_...` | |
| `STRIPE_PRICE_GROWTH_PER_PROPERTY` | `price_...` | |
| `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | `price_...` | |
| `COOK_COUNTY_DATA_BASE_URL` | `https://datacatalog.cookcountyil.gov` | Optional |
| `SMTP_HOST` | `smtpout.secureserver.net` | GoDaddy email → **Part 5** |
| `SMTP_PORT` | `587` | TLS |
| `SMTP_USER` | `support@overtaxed-il.com` | Full email address |
| `SMTP_PASSWORD` | *(your GoDaddy email password)* | Secret; store in Vercel only — never commit |
| `SMTP_FROM` | `support@overtaxed-il.com` | Sender shown to recipients |

Add `CRON_SECRET`, `AWS_*` if you use them. See **`.env.example`** and **Part 5** for GoDaddy email.

### 1.3 Deploy

1. Click **Deploy**
2. Wait for the build. If it fails, check **Build Logs** (often env or Prisma).
3. Open the **Visit** URL (e.g. `https://overtaxed-platform-xxx.vercel.app`) and confirm the app loads.

### 1.4 Stripe webhook (use Vercel URL first)

1. **Stripe Dashboard** → **Developers** → **Webhooks** → **Add endpoint**
2. **Endpoint URL:** `https://overtaxed-platform-xxx.vercel.app/api/billing/webhook` (your **Vercel project URL**)
3. **Events:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. **Add endpoint** → open it → **Reveal** **Signing secret** → copy `whsec_...`
5. **Vercel** → Overtaxed project → **Settings** → **Environment Variables** → add **STRIPE_WEBHOOK_SECRET** = `whsec_...`
6. **Redeploy**

---

## Part 2: Add custom domain in Vercel (before GoDaddy)

### 2.1 Add domain in Vercel

1. **Vercel** → **overtaxed-platform** project → **Settings** → **Domains**
2. Click **Add**
3. Enter **`www.overtaxed-il.com`** (or `overtaxed-il.com` if you prefer no www)
4. Click **Add**
5. **Copy the DNS records** Vercel shows (you’ll add these in GoDaddy next).

You’ll typically see:

- **www** → **CNAME** → `cname.vercel-dns.com`  
- **Apex** (optional) → **A** → `76.76.21.21` (or similar; use what Vercel shows)

---

## Part 3: GoDaddy — DNS

### 3.1 Open DNS for overtaxed-il.com

1. Go to **[godaddy.com](https://www.godaddy.com)** → sign in
2. **My Products** → **Domains**
3. Find **overtaxed-il.com** → **DNS** (or **Manage DNS**)

### 3.2 Add records (match Vercel exactly)

**For `www.overtaxed-il.com` (recommended):**

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **CNAME** | `www` | `cname.vercel-dns.com` | 600 (or default) |

- **Name:** `www` (or `www.overtaxed-il.com` depending on GoDaddy’s UI)
- **Value:** `cname.vercel-dns.com` (use the **exact** value from Vercel)
- Save

**For root `overtaxed-il.com` (optional):**

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `76.76.21.21` | 600 |

Use the **exact** A record value Vercel shows for the apex domain. Save.

### 3.3 Wait for DNS

- Propagation often takes **a few minutes** to a few hours.
- **Vercel** → **Settings** → **Domains** → your domain should eventually show **Valid Configuration** or **Verified**.
- Optional: check [dnschecker.org](https://dnschecker.org) for `www.overtaxed-il.com` and `overtaxed-il.com`.

---

## Part 4: Point app to live domain (after DNS is verified)

### 4.1 Update env vars in Vercel

1. **Vercel** → **overtaxed-platform** → **Settings** → **Environment Variables**
2. Update:
   - **NEXTAUTH_URL** = `https://www.overtaxed-il.com` (or `https://overtaxed-il.com` if you use root only)
   - **NEXT_PUBLIC_APP_URL** = same
   - No trailing slash.

### 4.2 Stripe webhook — live domain

1. **Stripe Dashboard** → **Developers** → **Webhooks**
2. Either **edit** the existing endpoint or **add** a new one:
   - **URL:** `https://www.overtaxed-il.com/api/billing/webhook` (or your chosen canonical domain)
3. If you **add** a new endpoint: **Reveal** **Signing secret** → copy `whsec_...`
4. **Vercel** → **Environment Variables** → set **STRIPE_WEBHOOK_SECRET** to that `whsec_...` (override the one used for the Vercel URL).
5. **Redeploy** the Overtaxed project.

### 4.3 Redeploy and test

1. **Deployments** → **⋯** on latest → **Redeploy**
2. Visit **https://www.overtaxed-il.com** (or your domain) and confirm the app loads.
3. Test sign-in and pricing/checkout if applicable.

---

## Part 5: GoDaddy Email → Vercel

Use a **GoDaddy email** (e.g. `support@overtaxed-il.com`) for transactional emails (deadline reminders, assessment alerts, etc.). The app uses **nodemailer** + SMTP; add these env vars in Vercel.

### 5.1 Create GoDaddy email account

1. **GoDaddy** → [godaddy.com](https://www.godaddy.com) → sign in  
2. **My Products** → **Domains** → **overtaxed-il.com** → **Email** or **Manage**  
3. **Add** / **Create Email Account**  
   - Address: `support@overtaxed-il.com` (or `noreply@overtaxed-il.com`)  
   - Password: use a strong password; you’ll put it in Vercel as `SMTP_PASSWORD`  
4. Save. If your plan doesn’t include email, add email hosting or use SendGrid/Postmark (see `docs/EMAIL_SETUP.md`).

### 5.2 GoDaddy SMTP settings

| Setting | Value |
|--------|--------|
| **Host** | `smtpout.secureserver.net` |
| **Port** | `587` (TLS) |
| **User** | Full email (e.g. `support@overtaxed-il.com`) |
| **Password** | The email account password |
| **From** | Same as User (e.g. `support@overtaxed-il.com`) |

### 5.3 Add SMTP env vars in Vercel

1. **Vercel** → **overtaxed-platform** → **Settings** → **Environment Variables**  
2. Add each (Production; add Preview if you test branch deploys):

| Name | Value |
|------|--------|
| `SMTP_HOST` | `smtpout.secureserver.net` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `support@overtaxed-il.com` *(or your address)* |
| `SMTP_PASSWORD` | *Your GoDaddy email password* — add in Vercel only, never commit |
| `SMTP_FROM` | `support@overtaxed-il.com` *(same as SMTP_USER)* |

3. **Save** each variable. Do **not** commit `SMTP_PASSWORD` to Git.

### 5.4 Redeploy and verify

1. **Deployments** → **⋯** on latest → **Redeploy**  
2. Trigger an email (e.g. appeal deadline reminder via `/api/cron/deadline-reminders` if you use it, or any flow that calls `sendEmail`).  
3. Check the recipient inbox and GoDaddy webmail/sent folder to confirm delivery.

**Troubleshooting:** If messages don’t send, check GoDaddy’s SMTP docs, confirm the email account works in webmail, and ensure no firewall blocks port 587. For better deliverability, consider SendGrid or Postmark (see `docs/EMAIL_SETUP.md`).

---

## Part 6: SSL (HTTPS)

Vercel provisions **SSL/TLS certificates** automatically for custom domains. Your site is served over **HTTPS** without extra configuration.

- **Vercel** → **Settings** → **Domains** → your domain: ensure SSL is **Enabled** (default). If you see “Certificate pending,” wait a few minutes after DNS is valid.
- No action needed in GoDaddy for SSL; Vercel handles issuance and renewal (e.g. Let’s Encrypt).

---

## Checklist

**Vercel**

- [ ] Project **overtaxed-platform** imported and deployed
- [ ] All env vars set (see table above; use **OVERTAXED_SECRETS_AND_PRICES.md** for reference)
- [ ] First deploy works on `https://overtaxed-platform-xxx.vercel.app`
- [ ] Stripe webhook for Vercel URL → `STRIPE_WEBHOOK_SECRET` set → redeploy
- [ ] Domain **www.overtaxed-il.com** (and optionally **overtaxed-il.com**) added in **Settings** → **Domains**
- [ ] DNS records from Vercel copied for GoDaddy

**GoDaddy**

- [ ] **DNS** open for **overtaxed-il.com**
- [ ] **CNAME** `www` → `cname.vercel-dns.com` added
- [ ] **A** `@` → `76.76.21.21` (or per Vercel) if using root domain
- [ ] DNS propagated; domain **Valid** in Vercel

**After go-live**

- [ ] **NEXTAUTH_URL** and **NEXT_PUBLIC_APP_URL** updated to `https://www.overtaxed-il.com` (or your domain)
- [ ] Stripe webhook URL updated to live domain; **STRIPE_WEBHOOK_SECRET** updated if changed
- [ ] **Redeploy** and test live site
- [ ] **SSL** — Vercel enables HTTPS for custom domains by default; confirm certificate is active in **Settings** → **Domains**

**GoDaddy email**

- [ ] Email account created (e.g. `support@overtaxed-il.com`) in GoDaddy
- [ ] **SMTP_HOST**, **SMTP_PORT**, **SMTP_USER**, **SMTP_PASSWORD**, **SMTP_FROM** set in Vercel (see Part 5)
- [ ] **Redeploy** after adding SMTP vars; verify sending (e.g. deadline reminders)

---

## Troubleshooting

**Domain “Invalid” or “Not configured” in Vercel**

- Confirm **Name** and **Value** in GoDaddy match Vercel **exactly** (e.g. `cname.vercel-dns.com`).
- Wait for DNS (up to 24–48 hours; often minutes).
- Use [dnschecker.org](https://dnschecker.org) to verify.

**Live site shows old app or wrong project**

- Confirm the domain is on the **overtaxed-platform** project (**Settings** → **Domains**).
- Clear cache / hard refresh; try incognito.

**Auth or redirects use vercel.app instead of your domain**

- **NEXTAUTH_URL** and **NEXT_PUBLIC_APP_URL** must be `https://www.overtaxed-il.com` (or your canonical URL), no trailing slash.
- Redeploy after changing env vars.

**Stripe webhook failing in production**

- Webhook URL must be `https://www.overtaxed-il.com/api/billing/webhook` (or your domain).
- **STRIPE_WEBHOOK_SECRET** in Vercel must match the **Signing secret** for that endpoint in Stripe.
- Redeploy after updating.

**GoDaddy email not sending**

- Confirm **SMTP_HOST** `smtpout.secureserver.net`, **SMTP_PORT** `587`, **SMTP_USER** = full email, **SMTP_PASSWORD** = email password, **SMTP_FROM** = same as user.
- Test the GoDaddy account in webmail first.
- Redeploy after changing SMTP vars. Check Vercel logs for `[email]` warnings.
- For better deliverability, use SendGrid or Postmark; see `docs/EMAIL_SETUP.md`.
