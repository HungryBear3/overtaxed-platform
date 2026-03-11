# Performance Fee Automation Flow

This document describes the end-to-end flow for automated performance fee billing and how to verify it.

## Flow Overview

```
assessment-checks (cron)
    → Detects Cook County reduction for filed appeal
    → Updates Appeal: outcome WON/PARTIALLY_WON, reductionAmount, taxSavings, decisionDate
    ↓
performance-invoices (cron)
    → Finds users with Performance Plan + appeals with taxSavings
    → Calculates 3-year savings via getThreeYearSavings()
    → Creates Stripe Invoice, sends to customer
    → Creates Invoice record in DB
    ↓
Stripe webhook (invoice.paid)
    → Marks Invoice PAID in DB
    ↓
invoice-collections (cron)
    → Finds overdue invoices (7, 14, 30, 45 days)
    → Sends collection emails (deadline reminders per Terms §4)
```

## Cron Schedule (vercel.json)

| Cron | Schedule | Purpose |
|------|----------|---------|
| assessment-checks | Mon 07:00 UTC | Fetch Cook County data, detect reductions, update appeals |
| performance-invoices | Mon 08:00 UTC | Create and send Stripe invoices for Performance Plan users |
| invoice-collections | Daily 09:00 UTC | Send overdue notices (7/14/30/45 days) |
| deadline-reminders | Daily 09:00 UTC | Remind users of filing deadlines |

## Verification Checklist

1. **Assessment check detects reduction**
   - Property has appeal with status FILED/UNDER_REVIEW/HEARING_SCHEDULED/DECISION_PENDING
   - Appeal has no outcome yet
   - Cook County returns lower assessed value than appeal's originalAssessmentValue
   - Run: `GET /api/cron/assessment-checks` with `Authorization: Bearer <CRON_SECRET>`
   - Check: Appeal updated with outcome, reductionAmount, taxSavings

2. **Performance invoice created**
   - User has subscriptionTier PERFORMANCE and performancePlanStartDate set
   - User has appeals with taxSavings in 3-year window
   - Run: `GET /api/cron/performance-invoices` with CRON_SECRET
   - Check: Stripe Invoice created and sent; Invoice record in DB

3. **Webhook marks invoice paid**
   - User pays Stripe invoice
   - Check: Invoice.status = PAID in DB

4. **Collection notices**
   - Invoice overdue (dueDate in past)
   - Run: `GET /api/cron/invoice-collections` with CRON_SECRET
   - Check: Email sent per schedule (7/14/30/45 days)

## Key Files

- `lib/monitoring/assessment-check.ts` — Reduction detection
- `lib/billing/performance-fee.ts` — getThreeYearSavings, createPerformanceFeeInvoice
- `lib/billing/stripe-invoice.ts` — Stripe Invoice create/send
- `app/api/billing/webhook/route.ts` — invoice.paid handler
- `app/api/cron/performance-invoices/route.ts` — Invoice creation cron
- `app/api/cron/invoice-collections/route.ts` — Collection notices
