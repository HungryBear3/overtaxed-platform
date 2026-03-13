# Phase 1 Validation Guide — Overtaxed IL

Run these tests after deployment to validate core flows. **Production URL:** https://www.overtaxed-il.com

---

## Automated checks (run first)

```powershell
cd overtaxed-platform
.\scripts\phase1-validation.ps1 -SkipCron -SkipAdmin
```

This verifies: site reachable, key pages (/, /pricing, /auth/signin, /terms, /faq, /contact), sitemap.xml, robots.txt.

**With secrets** (from Vercel env):

```powershell
$env:CRON_SECRET = "your-cron-secret"   # from Vercel
$env:ADMIN_SECRET = "your-admin-secret" # from Vercel
.\scripts\phase1-validation.ps1 -TestEmail "your-test@example.com"
```

**Cron test (manual):**

```powershell
Invoke-WebRequest -Uri "https://www.overtaxed-il.com/api/cron/deadline-reminders" `
  -Headers @{ "Authorization" = "Bearer YOUR_CRON_SECRET" }
```

Check response for 200 and any reminder emails sent.

---

## Manual test checklist

### 1. Live checkout — ~5 min

| Step | Action | Pass |
|------|--------|------|
| 1.1 | Sign in (or create account) | ☐ |
| 1.2 | Go to **Pricing** | ☐ |
| 1.3 | Complete Starter (1–2) or Growth payment | ☐ |
| 1.4 | Return to Account | ☐ |
| 1.5 | Confirm "X of Y slots used" matches paid quantity | ☐ |
| 1.6 | Click "Refresh subscription from Stripe" — count stays correct | ☐ |

**Pass:** Tier and slots update in Account/Dashboard without logging out.

---

### 2. Property limits — ~3 min

| Step | Action | Pass |
|------|--------|------|
| 2.1 | With 2–4 slots, add that many properties | ☐ |
| 2.2 | Try to add one more property | ☐ |
| 2.3 | Confirm blocked or upgrade prompt shown | ☐ |

**Pass:** API returns 403 when at limit; UI shows "at limit" hint.

---

### 3. Email delivery — ~2 min

| Step | Action | Pass |
|------|--------|------|
| 3.1 | Run cron: `GET /api/cron/deadline-reminders` with `Authorization: Bearer CRON_SECRET` | ☐ |
| 3.2 | Or: add property with appeal deadline → wait for cron | ☐ |
| 3.3 | Check inbox for reminder email | ☐ |
| 3.4 | Click link in email — lands on correct page | ☐ |

**Pass:** Email received; links work.

---

### 4. Stripe webhook — ~2 min

| Step | Action | Pass |
|------|--------|------|
| 4.1 | Complete checkout (or add-slot payment) | ☐ |
| 4.2 | Within ~30 sec, Account/Dashboard shows updated slots | ☐ |
| 4.3 | Vercel logs: search for `[webhook]` — "Event verified", "checkout.session.completed" | ☐ |
| 4.4 | Stripe Dashboard → Webhooks → recent events show 200 | ☐ |

**Pass:** Subscription updates in DB after payment; no manual refresh needed.

---

### 5. Appeal flow — ~8 min

| Step | Action | Pass |
|------|--------|------|
| 5.1 | Add Cook County property (PIN or address) | ☐ |
| 5.2 | Open property → **Comps** tab | ☐ |
| 5.3 | Run comps; results appear | ☐ |
| 5.4 | Click **"Start Appeal with These Comps"** | ☐ |
| 5.5 | Confirm Create Appeal page with property pre-selected, comps attached | ☐ |
| 5.6 | Create appeal | ☐ |
| 5.7 | On appeal detail: enter **Requested assessment value** (lower than original) | ☐ |
| 5.8 | Click **Save requested value** | ☐ |
| 5.9 | Download appeal summary PDF | ☐ |
| 5.10 | PDF opens/downloads; shows property, comps, requested value, filing instructions | ☐ |

**Pass:** Comps auto-attached; PDF downloads; no errors.

---

### 6. Filing authorization — ~6 min

| Step | Action | Pass |
|------|--------|------|
| 6.1 | On appeal detail page, find **"Authorize filing on your behalf"** in sidebar | ☐ |
| 6.2 | Fill form; check agree; submit | ☐ |
| 6.3 | Confirm "Authorization on file" with "Download authorization record" button | ☐ |
| 6.4 | Sign in as **admin** (role=ADMIN) | ☐ |
| 6.5 | Go to **Admin → Filing Queue** (`/admin/filing-queue`) | ☐ |
| 6.6 | See appeal with full auth data | ☐ |
| 6.7 | Click Auth PDF link — download works | ☐ |
| 6.8 | Click Appeal packet link — download works | ☐ |
| 6.9 | (Staff-assisted) Click **"Mark as filed"** — status updates to FILED; user receives appeal-filed email | ☐ |

**Pass:** User auth form + admin queue + PDF links + Mark as filed all work.

---

## Sign-off

| Area | Pass | Notes |
|------|------|-------|
| 1. Live checkout | ☐ | |
| 2. Property limits | ☐ | |
| 3. Email delivery | ☐ | |
| 4. Stripe webhook | ☐ | |
| 5. Appeal flow | ☐ | |
| 6. Filing authorization | ☐ | |

**Date:** ___________  
**Tester:** ___________
