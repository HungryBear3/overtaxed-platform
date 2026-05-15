Implement the OT condo outreach engineering spec in this repo.

Repo
- /Users/abigailclaw/overtaxed-platform

Source of truth
- docs/OT_OUTREACH_V1_RUNBOOK.md

Goal
Implement the engineering portion of the OT condo outreach v1 runbook without disturbing unrelated product flows.

Scope to implement
1. Prisma schema + migration for OT outreach tables
2. Outreach config/types/helpers
3. Suppression enforcement helpers
4. Resend webhook route for outreach events
5. One-click unsubscribe route /u/[token]
6. Send-time preflight enforcement helpers
7. Minimal docs updates only where needed to reflect implementation

Do not do
- no broad refactors
- no site redesign
- no unrelated product changes
- do not change existing transactional email behavior unless required for isolated outreach support
- do not invent a different data model than the runbook unless absolutely required by Prisma constraints; if so, keep behavior equivalent and explain why

Required behavior
- campaigns.status gate before every send
- suppression table enforced before send
- webhook_events must be idempotent using provider_event_id uniqueness
- complaint path must be able to suppress recipient and halt campaign
- one-click unsubscribe must insert suppression and render safe response
- invalid/expired unsubscribe token must not 500
- add outreach-specific sender/config helpers instead of hijacking current support email flow

Use these repo areas
- prisma/schema.prisma
- prisma/migrations/
- app/api/
- app/u/[token]/
- lib/

Recommended new files if useful
- app/api/outreach/webhooks/resend/route.ts
- app/u/[token]/route.ts
- lib/outreach/config.ts
- lib/outreach/types.ts
- lib/outreach/suppression.ts
- lib/outreach/webhooks.ts
- lib/outreach/send.ts
- lib/outreach/unsubscribe.ts

Existing files worth reading first
- prisma/schema.prisma
- app/api/leads/capture/route.ts
- lib/email/resend.ts
- lib/analytics/utm-tracking.ts

Implementation standards
- keep changes isolated and production-safe
- prefer explicit types
- avoid dead code and placeholders where real implementation is possible
- if external secrets/DNS/mailbox setup block full runtime validation, still implement code cleanly and note the external blockers

Verification required
- run relevant tests
- run full build
- if you add tests, include them in the run
- report exact files changed
- report any remaining external blockers separately from code blockers

Output format
Return exactly:
1. Summary
2. Files changed
3. Migrations added
4. Verification run
5. Remaining blockers
