# Monitoring & scheduled checks

## Schedule-based monitoring (reduce pings & costs)

Assessment checks are **schedule-gated** to align with Cook County’s release cadence:

1. **Reassessment season:** Only runs **January–August** (no checks Sep–Dec).
2. **Township-scoped:** Only checks properties in townships with an **active appeal window** (notice date −14 days through last file date +45 days). Properties without cached township are checked once to backfill.
3. **Vercel Cron:** `vercel.json` defines:
   - **Deadline reminders:** Daily at 9:00 UTC.
   - **Assessment checks:** Weekly on Mondays at 10:00 UTC (only runs during season and for active townships).

New properties get `township` stored on add. Existing properties get it when first checked. After that, we only ping Cook County for properties in townships where data is likely to have changed.

---

## Current behavior (detailed)

### 1. Appeal window opened (for PINs in our system)

**Not automated.** We do **not** run a scheduled job that checks whether the appeal window has opened for townships that match user properties.

- Township and filing deadline are looked up **on demand** when:
  - The user selects a property on the **new appeal** page (`/api/properties/lookup-deadline?pin=...`), or
  - The user adds a property (preview can show township).
- Township deadline data lives in `lib/appeals/township-deadlines.ts` (e.g. `TOWNSHIP_DEADLINES_2025`). That file is updated manually (or via the optional script `npm run township-deadlines:check`) when the Cook County Assessor calendar is updated.
- **Planned but not built:** Proactive “your township is now open for appeals” emails for users who have properties in that township but no appeal yet. See `docs/TOWNSHIP_DEADLINES_UPDATE.md` and the “Proactive User Notifications” section.

So today: **no automatic check** that the appeal window has opened for PINs in our system.

---

### 2. Reassessments / assessment checks

**Partially automated**, only for properties with **monitoring enabled**.

- **Endpoint:** `GET /api/cron/assessment-checks`  
  (Comment in code: *“Run periodically (e.g. monthly) via Vercel Cron or external scheduler”*.)
- **What it does:**
  - Loads all properties where `monitoringEnabled === true`.
  - For each, fetches current data from Cook County Open Data (`getPropertyByPIN`).
  - Updates `AssessmentHistory` and the property’s current assessment/land/improvement/market values and `lastCheckedAt`.
  - If the **latest year’s assessed value increased** vs what we had stored, it sends one “assessment increase” email to the property owner (when email is configured).
- **What it does *not* do:** It does not explicitly “check when reassessments come out.” It just refetches County data on whatever schedule you use; when the County API starts returning a new tax year for that PIN, we add it and may email on increase.

So: **we check reassessment data only for monitored properties, and only when the cron runs** (e.g. monthly if you set it that way). There is no separate “reassessment published” detector.

---

### 3. How often we check (intended vs configured)

- **Assessment checks**  
  - **Intended (in code comment):** “e.g. monthly.”  
  - **Actually configured:** Not defined in the repo. You must configure the schedule in **Vercel Cron** (or an external cron) that calls `GET /api/cron/assessment-checks` with `Authorization: Bearer <CRON_SECRET>`. If you never set that up, this job does not run on a regular basis.

- **Deadline reminders**  
  - **Intended (in code comment):** “Run daily.”  
  - **Actually configured:** Again, not in the repo. You need Vercel Cron (or an external scheduler) to call `GET /api/cron/deadline-reminders` daily with `Authorization: Bearer <CRON_SECRET>`.  
  - This job only emails users who **already have an appeal** (DRAFT or PENDING_FILING) with a filing deadline in the next 7 days; it sends at 7, 3, and 1 day before. It does **not** check “appeal window just opened” for properties that don’t have an appeal yet.

**`vercel.json`** now defines the cron schedule in the repo (daily reminders, weekly assessment checks).

---

## Summary table

| Check | Auto today? | How often (intended) | Notes |
|-------|-------------|----------------------|--------|
| Appeal window opened for PINs in system | **No** | N/A | Only on-demand lookup when user starts an appeal or adds property. Proactive “township open” emails are planned, not implemented. |
| Reassessments (new assessment data) | **Yes, for monitored properties only** | e.g. **monthly** (comment in code) | `GET /api/cron/assessment-checks`. Schedule must be set in Vercel or external cron. |
| Deadline reminders (existing appeals) | **Yes** | **Daily** (comment in code) | `GET /api/cron/deadline-reminders`. Schedule must be set in Vercel or external cron. |

---

## Enabling the crons

1. Set **`CRON_SECRET`** in your environment (e.g. Vercel env vars).
2. In **Vercel** → Project → Settings → Cron (or use Vercel’s cron in `vercel.json`), add:
   - **Daily:** `GET https://<your-domain>/api/cron/deadline-reminders` with header `Authorization: Bearer <CRON_SECRET>`.
   - **Monthly (or desired interval):** `GET https://<your-domain>/api/cron/assessment-checks` with the same header.
3. For assessment checks to run for a property, that property must have **monitoring enabled** (default is `true` for new properties; users can turn it off on the property page).

If you want, we can add a `vercel.json` with suggested cron entries so the “how often” is defined in the repo.
