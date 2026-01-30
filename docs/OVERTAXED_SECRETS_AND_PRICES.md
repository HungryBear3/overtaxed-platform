# Overtaxed: Base64 Secret, Stripe Webhook Secret, and Price IDs

Reference for **NEXTAUTH_SECRET**, **STRIPE_WEBHOOK_SECRET**, and all Stripe price IDs when deploying Overtaxed (e.g. to Vercel).

---

## Security: never commit secrets

- **`.env.local`** is **gitignored** — it is **not** committed or pushed to GitHub. Store real secrets there locally.
- **This doc** uses **placeholders only** (`your-base64-secret`, `whsec_...`, `price_...`). Do **not** add real secret values to this file.
- **Production:** Store real values in **Vercel** → Project → **Settings** → **Environment Variables** (or your host’s env config). Never commit them.

**If you ever commit a secret:** Rotate it immediately (new NEXTAUTH_SECRET, new Stripe webhook secret, etc.). Consider making the repo **private** to limit who can see code and docs, but **never committing secrets** is what keeps you safe.

---

## 1. Base64 secret (NEXTAUTH_SECRET)

**Where to store it:** `overtaxed-platform` **`.env.local`** (local) and **Vercel** env vars (production). **Do not put the real value in this doc.**

**Generate one:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use the output as **NEXTAUTH_SECRET** in `.env.local` and in Vercel. Keep it secret.

---

## 2. Stripe webhook secret (STRIPE_WEBHOOK_SECRET)

**Where to store it:** **`.env.local`** (local) and **Vercel** env vars (production). **Do not put the real value in this doc.**

### Local development

1. Install [Stripe CLI](https://stripe.com/docs/stripe-cli) (or `scoop install stripe`).
2. `stripe login`
3. `stripe listen --forward-to localhost:3000/api/billing/webhook`
4. Copy the **Signing secret** (`whsec_...`) and set **STRIPE_WEBHOOK_SECRET** in `.env.local`.

### Vercel / production

1. [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks** → **Add endpoint**.
2. **Endpoint URL:** `https://<your-overtaxed-vercel-url>/api/billing/webhook`
3. **Events:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. **Add endpoint** → open it → **Reveal** **Signing secret** → copy `whsec_...`
5. **Vercel** → Overtaxed project → **Settings** → **Environment Variables** → add **STRIPE_WEBHOOK_SECRET** = `whsec_...`
6. **Redeploy.**

Use **Test** vs **Live** mode endpoints and secrets as appropriate. **Live mode:** In Stripe Dashboard, switch to **Live** (toggle top right); create a **live** webhook for `https://www.overtaxed-il.com/api/billing/webhook` (or your live domain) and use the **live** signing secret and **live** API keys + price IDs in Vercel **Production**. See **`docs/STRIPE_SETUP.md`** section 6 (Live Stripe).

---

## 3. Stripe price IDs (all four)

**Where to get them:** **Stripe Dashboard** → **Products** → each product → **Pricing** → copy the **Price ID** (`price_...`). Or use the values in **`.env.local`** (gitignored).

**Env variables to set** (in `.env.local` and Vercel):

| Env variable | Placeholder | Product |
|--------------|-------------|---------|
| `STRIPE_PRICE_COMPS_ONLY` | `price_...` | DIY reports only ($69 one-time) |
| `STRIPE_PRICE_STARTER` | `price_...` | Starter ($149/property/year) |
| `STRIPE_PRICE_GROWTH_PER_PROPERTY` | `price_...` | Growth ($125/property/year, 3–9 props) |
| `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | `price_...` | Portfolio ($100/property/year, 10–20 props) |

Add these in **Vercel** (Overtaxed project → **Settings** → **Environment Variables**) with your actual price IDs from Stripe or `.env.local`.

Also set **NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY** and **STRIPE_SECRET_KEY** (from `.env.local` / Stripe) in Vercel.

---

## Quick checklist for Vercel

- [ ] **NEXTAUTH_SECRET** = base64 secret (from `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` or `.env.local`)
- [ ] **STRIPE_WEBHOOK_SECRET** = `whsec_...` from Stripe webhook for `https://<your-app>/api/billing/webhook`
- [ ] **STRIPE_PRICE_COMPS_ONLY** = `price_...`
- [ ] **STRIPE_PRICE_STARTER** = `price_...`
- [ ] **STRIPE_PRICE_GROWTH_PER_PROPERTY** = `price_...`
- [ ] **STRIPE_PRICE_PORTFOLIO_PER_PROPERTY** = `price_...`
- [ ] **Live Stripe:** For production, use **live** keys (`pk_live_...`, `sk_live_...`), **live** webhook secret, and **live** price IDs in Vercel Production; see `docs/STRIPE_SETUP.md` section 6.

Use **only** placeholders in this doc. Store real values in `.env.local` (local) and Vercel (production).
