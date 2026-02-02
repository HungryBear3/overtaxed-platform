# Vercel Preview + Stripe Test Mode Setup

Use this guide to set up a Preview environment where you can test Stripe checkout with **test cards** (e.g. 4242 4242 4242 4242) without real charges.

---

## Prerequisites

- Stripe account with **test mode** products and prices created
- Test mode API keys from Stripe Dashboard (toggle "Test mode" in top right)

---

## Step 1: Get Stripe Test Credentials

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle **Test mode** ON (top right)
3. **Developers** → **API keys** → Copy:
   - Publishable key: `pk_test_...`
   - Secret key: `sk_test_...`
4. **Products** → For each product (Starter, Growth, Portfolio, Comps Only), copy the **Price ID** (e.g. `price_1ABC...`)

---

## Step 2: Add Preview Environment Variables in Vercel

1. Go to [Vercel Dashboard](https://vercel.com) → **overtaxed-platform** project
2. **Settings** → **Environment Variables**
3. For each variable below, add a **new row** with the **same name** but:
   - **Value:** test key / test price ID
   - **Environments:** Check **Preview only** (uncheck Production, uncheck Development)
   - Click **Save**

| Name | Value (Preview) |
|------|-----------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `STRIPE_PRICE_STARTER` | `price_...` (test) |
| `STRIPE_PRICE_GROWTH_PER_PROPERTY` | `price_...` (test) |
| `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | `price_...` (test) |
| `STRIPE_PRICE_COMPS_ONLY` | `price_...` (test) |

**Note:** You will add `STRIPE_WEBHOOK_SECRET` in Step 4 after creating the Preview webhook.

---

## Step 3: Create a Preview Branch & Deploy

1. Push to a branch other than `main` (e.g. `develop`):
   ```powershell
   git checkout -b develop
   git push origin develop
   ```
2. Vercel will auto-deploy a **Preview** at a URL like:
   - `https://overtaxed-platform-xxx-yourteam.vercel.app`
   - Or: `https://overtaxed-platform-git-develop-yourteam.vercel.app`
3. Copy this URL — you need it for the webhook.

---

## Step 4: Create Stripe Test Webhook

1. In Stripe Dashboard, ensure **Test mode** is ON
2. **Developers** → **Webhooks** → **Add endpoint**
3. **Endpoint URL:** `https://YOUR-PREVIEW-URL.vercel.app/api/billing/webhook`
   - Replace `YOUR-PREVIEW-URL` with the actual Preview URL from Step 3
4. **Events to send:** Select `checkout.session.completed` (or "Events on your account" → Checkout)
5. Click **Add endpoint**
6. Click **Reveal** under "Signing secret" → Copy `whsec_...`
7. In Vercel → **Environment Variables** → Add:
   - **Name:** `STRIPE_WEBHOOK_SECRET`
   - **Value:** `whsec_...` (the test webhook secret)
   - **Environments:** **Preview only**
   - Save
8. **Redeploy** the Preview (Vercel → Deployments → ... → Redeploy) so it picks up the new env var.

---

## Step 5: Test Checkout

1. Open your **Preview** URL (not the production URL)
2. Sign up or sign in
3. Go to **Pricing** → Click **Get started** on Starter (or any plan)
4. Use test card: `4242 4242 4242 4242`
   - Expiry: any future date (e.g. 12/34)
   - CVC: any 3 digits (e.g. 123)
   - ZIP: any 5 digits (e.g. 60601)
5. Complete checkout — it should succeed and your dashboard should show the new tier after the webhook fires.

---

## Caveats

- **Preview URL changes** when you push new commits or switch branches. If the webhook stops working, update the webhook URL in Stripe to match the new Preview URL, or redeploy the same branch to get a stable URL.
- **Production** (`main` branch, overtaxed-il.com) continues to use **live** Stripe keys — unaffected by Preview settings.
- **Database:** Preview and Production share the same database. Test users/subscriptions you create in Preview will appear in Production. Consider using a separate test email (e.g. `test+starter@yourdomain.com`) to avoid confusion.

---

## Quick Checklist

- [ ] Stripe test mode products/prices created
- [ ] Test API keys and price IDs added to Vercel (Preview env only)
- [ ] Preview branch pushed; Preview deploy exists
- [ ] Stripe test webhook created pointing to Preview URL
- [ ] `STRIPE_WEBHOOK_SECRET` (test) added to Vercel Preview
- [ ] Preview redeployed after adding webhook secret
- [ ] Checkout tested with 4242 4242 4242 4242 on Preview URL
