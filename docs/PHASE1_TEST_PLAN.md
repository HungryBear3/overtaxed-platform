# Phase 1 Test Plan — Overtaxed Platform

Use this checklist to validate billing, limits, webhook, and appeal flow before launch. Run against **production** (or Preview with test Stripe keys).

---

## 1. Billing & Checkout

- [ ] **Account → slots**  
  Log in, go to Account. Confirm "X of Y slots used" matches your Stripe (e.g. 4 of 4 if you have 2 Starter + 2 Growth).

- [ ] **Refresh subscription**  
  Click "Refresh subscription from Stripe". Slot count should stay correct (or update if you changed something in Stripe).

- [ ] **Pricing page**  
  - Starter card: if on Starter with 1 slot, shows "1/2 slots used" and "1 slot (current)" / "2 slots — add 1 more (+$149/yr)".  
  - Growth card: if on Starter with 2 slots, "Add 1 more" shows $124/yr (3 total), not $372.

- [ ] **Add one slot (if under limit)**  
  Add one Growth (or Starter) slot via Pricing → pay → confirm redirect to **Account** (not stuck on Stripe). Account shows +1 slot; Stripe subscription quantity is tier-only (e.g. Growth = 2, not total 5).

- [ ] **Manage subscription**  
  Account → "Manage subscription" opens Stripe Customer Portal; can cancel or update payment method.

---

## 2. Property limits

- [ ] **At limit**  
  With 4 slots, add 4 properties. Fifth "Add property" should be blocked or show upgrade prompt.

- [ ] **Dashboard/Account**  
  Dashboard and Account show same slot count and property count; "X of Y used" is consistent.

---

## 3. Webhook (Stripe → DB)

- [ ] **After checkout**  
  Complete a checkout (or add-slot payment). Within a few seconds, Account/Dashboard should show updated tier and slots without logging out.

- [ ] **Vercel logs**  
  In Vercel → Deployments → Logs, search for `[webhook]`. After a payment you should see "Event verified", "checkout.session.completed" or "Add-slots: updated subscription... total slots=...".

- [ ] **Stripe Dashboard**  
  Developers → Webhooks → your endpoint → recent events. `checkout.session.completed` and `customer.subscription.updated` should show 200 responses.

---

## 4. Appeal flow

- [ ] **Create property**  
  Add a Cook County property (by PIN or address). Property detail loads; assessment value shown (or "Refresh property data" if needed).

- [ ] **Comps**  
  Open property → Comps. Run comps; results appear.

- [ ] **Start appeal with comps**  
  Click "Start Appeal with These Comps". You land on Create Appeal with the selected property; comps are attached (green notice). Create appeal.

- [ ] **Set requested value**  
  On the appeal detail page, in the **Assessment Values** section you’ll see “Requested assessment value is required before you can download your appeal summary PDF.” Enter a value **lower than the original** (e.g. 250000) and click **Save requested value**. You can use **Change** later to edit it.

- [ ] **PDF summary**  
  Click download appeal summary PDF. PDF opens or downloads; no "site not available" or McAfee block. Content shows property, comps, requested value, filing instructions.

- [ ] **Mark as filed**  
  After filing at Cook County (or for test), set status to "Mark as Filed". Status updates.

---

## 5. Email (optional)

- [ ] **Deadline reminder**  
  If you have `CRON_SECRET` and a property in a township with deadlines:  
  `GET/POST https://www.overtaxed-il.com/api/cron/deadline-reminders` with header `Authorization: Bearer <CRON_SECRET>`. Check logs or inbox for reminder.

---

## Sign-off

| Area           | Pass | Notes |
|----------------|------|--------|
| Billing/Checkout | ☐   |       |
| Property limits  | ☐   |       |
| Webhook          | ☐   |       |
| Appeal flow      | ☐   |       |
| Email (optional) | ☐   |       |

**Date:** ___________  
**Tester:** ___________
