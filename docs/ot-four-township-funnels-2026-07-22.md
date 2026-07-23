# Four township funnels — internal implementation

Status: **internal, not deployed; follow-up copy is not activated**

The four routes are `/appeal-deadline/cicero`,
`/appeal-deadline/elk-grove`, `/appeal-deadline/stickney`, and
`/appeal-deadline/west-chicago`. Each route reads its date from the official
2026 CCAO deadline table, gives the free property check one primary CTA, and
uses the existing UTM capture path for campaign attribution.

At the end of the official last-file day, the route automatically changes to
closed-window copy and becomes `noindex`. The sitemap uses the same state and
revalidates twice daily, so expired campaign routes are removed there too.

The email/SMS material in
`lib/marketing/township-followup-drafts.ts` is inert copy only. It has no
sender, route, cron, enrollment, database write, or provider integration.
Activation requires separate approval plus consent, unsubscribe/STOP,
suppression, current-date verification, and exact send-window review.
