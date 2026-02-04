# Stripe Dashboard Setup

Overtaxed uses Stripe for DIY reports, Starter, Growth, and Portfolio. Follow these steps in order.

---

## 1. Stripe account and API keys

1. Sign up at [dashboard.stripe.com](https://dashboard.stripe.com).
2. Use **Test mode** (toggle in the top right) for development.
3. Go to **Developers → API keys**.
4. Copy:
   - **Publishable key** (`pk_test_...`)
   - **Secret key** (`sk_test_...`)
5. Add to `.env.local`:

   ```env
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
   STRIPE_SECRET_KEY="sk_test_..."
   ```

6. Set your app URL (for checkout redirects):

   ```env
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

   Use your production URL (e.g. `https://yourapp.com`) in production.

---

## 2. Create products and prices

Go to **Product catalog → Products → Add product**. Create each product below. For each, add a **Price** as specified. After creating a price, copy its **Price ID** (`price_...`) — you’ll add these to `.env.local` in step 3.

---

### 2a. DIY reports only (Comps only)

- **Product name:** `DIY reports only` (or `Comps only`)
- **Description:** `Rule 15–compliant comps + evidence packet. One-time per property.`
- **Price:**
  - **Pricing model:** Standard pricing
  - **Price:** `$69.00` USD
  - **Billing period:** One time
- **Env variable:** `STRIPE_PRICE_COMPS_ONLY`

**Note:** DIY is one-time per property. Checkout uses `quantity = 1` per purchase (or quantity = number of properties if you sell multiple at once). The pricing page currently links “Get comps” to signup; you can later add a checkout flow that uses this price.

---

### 2b. Starter

- **Product name:** `Starter`
- **Description:** `Full automation per property. $149/property/year.`
- **Price:**
  - **Pricing model:** Standard pricing
  - **Price:** `$149.00` USD
  - **Billing period:** Yearly (every 12 months)
  - **Recurring:** Yes
- **Env variable:** `STRIPE_PRICE_STARTER`

Checkout uses **quantity = number of properties** (1–2). Total charge = `$149 × quantity` per year.

---

### 2c. Growth

- **Product name:** `Growth`
- **Description:** `Full automation for 3–9 properties. $125/property/year.`
- **Price:**
  - **Pricing model:** Standard pricing
  - **Price:** `$125.00` USD
  - **Billing period:** Yearly (every 12 months)
  - **Recurring:** Yes
- **Env variable:** `STRIPE_PRICE_GROWTH_PER_PROPERTY`

Checkout uses **quantity = number of properties** (3–9). Total charge = `$125 × quantity` per year.

---

### 2d. Portfolio

- **Product name:** `Portfolio`
- **Description:** `Full automation for 10–20 properties. $100/property/year.`
- **Price:**
  - **Pricing model:** Standard pricing
  - **Price:** `$100.00` USD
  - **Billing period:** Yearly (every 12 months)
  - **Recurring:** Yes
- **Env variable:** `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY`

Checkout uses **quantity = number of properties** (10–20). Total charge = `$100 × quantity` per year.

---

## 3. Add price IDs to `.env.local`

Add the Price IDs from step 2:

```env
# DIY reports only ($69 one-time per property)
STRIPE_PRICE_COMPS_ONLY="price_..."

# Starter ($149/property/year)
STRIPE_PRICE_STARTER="price_..."

# Growth ($125/property/year, 3–9 properties)
STRIPE_PRICE_GROWTH_PER_PROPERTY="price_..."

# Portfolio ($100/property/year, 10–20 properties)
STRIPE_PRICE_PORTFOLIO_PER_PROPERTY="price_..."
```

Restart your dev server after changing env vars.

---

## 4. Webhook (required for subscriptions)

The app uses webhooks to update `subscriptionTier` and `subscriptionStatus` when users complete checkout or when subscriptions change.

### Production

1. **Developers → Webhooks → Add endpoint**
2. **Endpoint URL:** `https://your-domain.com/api/billing/webhook`
3. **Events to send:**  
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`).
5. Add to `.env.local` (or your hosting env):

   ```env
   STRIPE_WEBHOOK_SECRET="whsec_..."
   ```

### Local testing (get the webhook secret)

Stripe can’t reach `localhost` directly, so you use the **Stripe CLI** to forward webhook events to your app and get a **local** signing secret.

**If you already installed Stripe CLI** (e.g. for the newstart-il project via Scoop), you can reuse it — just run the Overtaxed webhook URL below. If not, install and log in first.

1. **Install Stripe CLI** (only if not already installed)
   - **Windows (Scoop):** If you have [Scoop](https://scoop.sh), run: `scoop install stripe`
   - **Windows (manual):** If `stripe` is not recognized:
     1. Go to [github.com/stripe/stripe-cli/releases](https://github.com/stripe/stripe-cli/releases/latest)
     2. Download `stripe_X.X.X_windows_x86_64.zip`
     3. Unzip to a folder (e.g. `C:\stripe-cli`)
     4. Add that folder to your PATH, or run from that folder: `.\stripe.exe listen --forward-to localhost:3000/api/billing/webhook`
   - **macOS:** `brew install stripe/stripe-cli/stripe`
   - **Or:** [Stripe CLI install guide](https://stripe.com/docs/stripe-cli#install)

2. **Log in** (one-time per machine; you may already be logged in from newstart-il):
   ```bash
   stripe login
   ```
   This opens a browser to link the CLI to your Stripe account.

3. **Start the webhook listener for Overtaxed** (keep this terminal open while testing):
   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
   **Note:** Overtaxed uses `/api/billing/webhook`. Newstart-il uses `/api/webhooks/stripe` — use the URL above for this project.

4. **Copy the webhook signing secret**  
   The CLI prints something like:
   ```text
   Ready! Your webhook signing secret is whsec_<your-secret>
   ```
   Copy the full `whsec_...` value.

5. **Add it to Overtaxed’s `.env.local`** (in the `overtaxed-platform` folder):
   ```env
   STRIPE_WEBHOOK_SECRET="whsec_<paste-value-from-cli>"
   ```
   **If a webhook secret was ever committed to git:** Rotate it in Stripe (Developers → Webhooks → add a new endpoint or recreate the existing one), then set the new signing secret in your environment (e.g. Vercel) and redeploy.

6. **Restart your Next.js dev server** so it picks up the new env var.

**While testing:** Leave `stripe listen` running in one terminal and your app in another. When you complete a test checkout, Stripe sends the event through the CLI to your app so the webhook handler can run and update the user’s subscription.

---

## 5. Verify (test mode)

1. **Pricing page** (`/pricing`): Sign in, then click “Get started” on Starter, Growth, or Portfolio. You should be redirected to Stripe Checkout with the correct plan and amount.
2. **Checkout:** Complete a test payment (use [Stripe test cards](https://stripe.com/docs/testing#cards), e.g. `4242 4242 4242 4242`).
3. **Webhook:** After checkout, the user’s `subscriptionTier` and `subscriptionStatus` should update (see **Account** or **Dashboard**).
4. **DIY:** The “Get comps” button currently goes to signup. When you add a DIY checkout route, it should use `STRIPE_PRICE_COMPS_ONLY`.

---

## 6. Live Stripe (production)

When you’re ready to accept real payments on **https://www.overtaxed-il.com** (or your live domain):

### 6.1 Switch to Live mode in Stripe

1. **Stripe Dashboard** → toggle **Test mode** off (top right) to **Live mode**.
2. **Developers → API keys** → copy **Publishable key** (`pk_live_...`) and **Secret key** (`sk_live_...`).

### 6.2 Create live products and prices

Live mode has a **separate** product catalog from test mode. Create the same products and prices in Live mode (DIY, Starter, Growth, Portfolio) per section 2 above, or use **Product catalog → Products** and duplicate from test if Stripe supports it. Copy each **live** Price ID (`price_...`).

### 6.3 Live webhook

1. **Developers → Webhooks → Add endpoint** (in **Live** mode).
2. **Endpoint URL:** `https://www.overtaxed-il.com/api/billing/webhook` (or your live domain).
3. **Events:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. **Add endpoint** → open it → **Reveal** **Signing secret** → copy `whsec_...` (this is your **live** webhook secret).

### 6.4 Update Vercel environment variables

In **Vercel** → overtaxed-platform → **Settings** → **Environment Variables**, set (for **Production**):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from live webhook above) |
| `STRIPE_PRICE_COMPS_ONLY` | live Price ID |
| `STRIPE_PRICE_STARTER` | live Price ID |
| `STRIPE_PRICE_GROWTH_PER_PROPERTY` | live Price ID |
| `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | live Price ID |

**Redeploy** after changing env vars.

### 6.5 Test live (small real charge)

1. Visit your live site, sign in, go to **Pricing**, and start a checkout (e.g. Starter with 1 property).
2. Use a **real card** for a small amount (e.g. $149); confirm checkout completes and user tier updates.
3. Optionally refund the test charge in **Stripe Dashboard → Payments**.

---

## 7. Testing checklist (quick reference)

- **Test mode (local):** `stripe listen --forward-to localhost:3000/api/billing/webhook`; use test cards (e.g. `4242 4242 4242 4242`).
- **Test mode (Vercel):** Webhook endpoint = Vercel URL or test subdomain; use test keys and test price IDs in Vercel env.
- **Live mode:** Use live keys, live price IDs, and live webhook secret in Vercel **Production**; test with one small real payment, then refund if desired.
- **Verify:** After checkout, user’s **Account** or **Dashboard** shows correct `subscriptionTier` and `subscriptionStatus`; Stripe **Customers** and **Subscriptions** show the customer and subscription.

---

## Quick reference

| Product     | Price       | Billing       | Env variable                    | Checkout quantity      |
|------------|-------------|---------------|----------------------------------|------------------------|
| DIY reports| $69/property| One-time      | `STRIPE_PRICE_COMPS_ONLY`       | 1 (or # of properties) |
| Starter    | $149/property| Yearly       | `STRIPE_PRICE_STARTER`          | # of properties (1–5)  |
| Growth     | $125/property| Yearly       | `STRIPE_PRICE_GROWTH_PER_PROPERTY` | # of properties (3–9)  |
| Portfolio  | $100/property| Yearly       | `STRIPE_PRICE_PORTFOLIO_PER_PROPERTY` | # of properties (10–20) |

- **Performance** (4% of savings, deferred) and **20+ properties** (custom) are not in Stripe; they use “Contact us” flows.
- Pricing constants: `lib/billing/pricing.ts`
- Stripe client and `PRICE_IDS`: `lib/stripe/client.ts`
- Checkout API: `app/api/billing/checkout/route.ts`
- Webhook handler: `app/api/billing/webhook/route.ts`
