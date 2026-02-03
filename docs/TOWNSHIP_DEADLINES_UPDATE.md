# Township Deadline Data: Annual Update Process

## When Are Deadlines Published?

Cook County Assessor publishes the [Assessment & Appeal Calendar](https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines) annually. The page is **updated progressively** as townships open:

- **Timing:** New year's data typically appears in **late fall / early winter** (Nov–Jan). The calendar shows "Last updated: [date]" at the top.
- **No fixed date:** There is no single "publish day" — the Assessor adds townships as the triennial reassessment cycle progresses. North suburbs, City of Chicago, and South/West suburbs rotate.
- **GovDelivery alerts:** Subscribe at [Cook County GovDelivery](https://content.govdelivery.com/accounts/ILCOOK) to receive bulletins when they publish "Revised Assessment Calendar & Deadlines."

---

## Annual Update Process

### 1. Get notified

- **Subscribe:** Add your email to Cook County GovDelivery (ILCOOK) for Assessor bulletins.
- **Calendar reminder:** Set a reminder for **January 1** and **July 1** to check the calendar page for the current tax year.

### 2. Fetch and review new data

1. Open https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines
2. For each township section (North Suburbs, City of Chicago & South/West), note:
   - Township name
   - Reassessment Notice Date (MM/DD/YYYY)
   - Last File Date (MM/DD/YYYY) — this is the Assessor appeal filing deadline

### 3. Update the codebase

1. Edit `lib/appeals/township-deadlines.ts`
2. Add a new constant for the year, e.g. `TOWNSHIP_DEADLINES_2026`
3. Add entries in the same format:
   ```ts
   "township name": { noticeDate: "YYYY-MM-DD", lastFileDate: "YYYY-MM-DD" },
   ```
4. Update `getTownshipDeadline()` to use the current tax year's map (e.g. switch or year-based lookup).
5. Add a source comment with the Assessor URL and "Last updated" date.

### 4. Run the helper script (optional)

```bash
cd overtaxed-platform
npm run township-deadlines:check
# or: npx tsx scripts/check-township-deadlines.ts
```

This script fetches the calendar page and prints suggested TypeScript entries for review. Parsing is best-effort — if the Assessor changes the page structure, the output may be incomplete. Always verify against the official page before merging.

---

## Proactive User Notifications (Planned)

Once new year data is in place, we can:

1. **Match users by township:** For each user property (PIN), look up township via Cook County API.
2. **Identify affected properties:** Find properties in townships with upcoming appeal windows.
3. **Send notifications:**
   - When a township opens: "Your township [X] is now open for appeals. Filing deadline: [date]. [Start appeal]"
   - 7 days before deadline: "Filing deadline for [township] is in 7 days."
   - 3 days before: Same, with stronger CTA.

This extends the existing `deadline-reminders` cron (which emails users who already have appeals with upcoming deadlines) to also reach users who have **no appeal yet** but whose properties are in townships with open appeal windows.

---

## Files to Update

| File | Purpose |
|------|---------|
| `lib/appeals/township-deadlines.ts` | Township → noticeDate, lastFileDate mapping |
| `app/api/properties/lookup-deadline/route.ts` | Uses `getTownshipDeadline()` — no change if API stays the same |
| `app/api/cron/deadline-reminders/route.ts` | Extend to add "township opened" / proactive notifications |
