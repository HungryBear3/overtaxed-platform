# Deliverable 5 — Canonical Copy Library & Banned-Claims Lexicon
**Specification only · 2026-08-18 · NOT IMPLEMENTED**

Every string below carries an ID. The 88-path matrix (Deliverable 8) references these IDs as replacements. **One string, one ID, one meaning, every surface** — the project's own copy review found a single contingency term rendered four different ways across four surfaces; the ID system exists to make that impossible.

## Part 1 — Canonical copy

| ID | Purpose | Canonical string |
|---|---|---|
| **CC-01** | Service description | *"OverTaxed IL analyzes public Cook County records and prepares a defined Assessor-stage appeal packet. You review it, sign it, and file it yourself."* |
| **CC-02** | Free-check promise — **MANDATED VERBATIM, DO NOT EDIT** | *"This free check compares available public Cook County records. It estimates whether the evidence appears to support closer review. It does not predict whether an appeal will succeed or reduce taxes."* |
| **CC-03** | Result state A | *"Appears supportive of closer review"* |
| **CC-04** | Result state B | *"Does not presently appear supportive"* |
| **CC-05** | Result state C | *"Insufficient evidence"* |
| **CC-06** | Result state D | *"Unsupported property/stage"* |
| **CC-07** | Limitations | *"Public records may be incomplete, out of date, or inconsistent. This analysis uses only what was retrievable at the time shown, and cannot account for condition, interior finish, or other facts the public record does not carry."* |
| **CC-08** | Freshness | *"Deadline shown as published by {source} and retrieved {timestamp}. Confirm your filing deadline with the county before you file."* |
| **CC-09** | Township resolution | *"Your township is resolved from your address and PIN in the county's own records, not from your neighbourhood name. Chicago neighbourhoods can span more than one assessment township, and townships have different deadlines."* |
| **CC-10** | Homeowner-filed packet | *"The $69 packet is a preparation service. We prepare it; you review it, sign it, and file it with the county yourself."* |
| **CC-11** | BOR future-only notice | *"OverTaxed IL does not file, sign, prepare, handle, or represent anyone at the Cook County Board of Review. Under the Board's own rules, only a licensed attorney or the taxpayer personally may practise before it. If we ever offer anything at that stage, it would be attorney-led. Do not wait for us — confirm your own deadline with the county."* |
| **CC-12** | No legal advice / no outcome guarantee | *"OverTaxed IL is not a law firm and does not provide legal or tax advice. We do not guarantee a reduction. County decisions are final, and a change in assessed value does not produce an equal change in a tax bill."* |
| **CC-13** | Refunds | *"We refund in full if we do not deliver, or if the packet has a material defect we cannot correct. We do not charge at all if we cannot produce what we promised. No county outcome — granted, denied, or partial — creates a refund right."* |
| **CC-14** | Support | *"Support covers how the packet works, where each figure came from, and corrections. It does not cover advice on whether to file or on the merits of your property. Up to two email exchanges within 14 days of delivery."* |
| **CC-15** | Decline / refusal | *"We can't advise you on that. Whether to appeal is your decision, and we're not able to weigh in on the merits of a specific property. The county publishes the records and the filing route free, and both are linked here."* |
| **CC-16** | Closed / unavailable deadline | *"The {stage} window for {resolved township} is not open according to {source}, retrieved {timestamp}. We are not selling a packet for a closed window. Confirm the current status with the county — your rights are not affected by anything on this page."* |
| **CC-17** | Checkout eligibility | *"We only sell a packet when the Assessor window is open for your resolved township, your property is class 2 residential in Cook County with a single PIN, and our sources were complete and current at the time of the check. If any of those is not true, checkout is closed and you are not charged."* |
| **CC-18** | Standing footer | `CC-01` + `CC-12`, rendered on every consumer surface without exception. |

## Part 2 — Banned-claims lexicon

Enforced as automated assertions in CI. **Negation trap:** `CC-12` legitimately contains "guarantee a reduction" and "legal advice"; strip approved canonical strings before asserting, or use negative lookbehind. Getting this wrong red-lines a correct build.

### BL-A — Filing / representation ambiguity (severity: CRITICAL)

| ID | Banned | Why |
|---|---|---|
| BL-A1 | "we file", "we'll file", "we submit", "filed on your behalf", "submission on your behalf" | Contradicts homeowner-files posture; at BOR it is barred by rule |
| BL-A2 | "Board of Review forms submission", "we handle the Board of Review", "BOR filing" | Board Rule 1 bars non-attorney practice |
| BL-A3 | "your filing authorization", "sign the authorization" (as an OverTaxed-files trigger) | Implies representation |
| BL-A4 | "we represent", "your representative", "on your behalf" (unqualified) | Representation language |
| BL-A5 | "we win", "if we win", "we won", "our wins" | Casts OverTaxed as advocate in a contested matter |
| BL-A6 | "done-for-you", "we handle everything", "full appeal management", "dedicated case manager" | Describes a service posture on HOLD (posture item 5) |
| BL-A7 | "coming soon" + Board of Review, "join the waitlist" (BOR) | Induces deferral on a live deadline — highest-harm misreading (CF-9) |

### BL-B — Win / savings / outcome claims (severity: CRITICAL)

| ID | Banned |
|---|---|
| BL-B1 | "save an average of", "average savings", "$X+/year", any averaged savings figure |
| BL-B2 | any success rate, win rate, "% of our customers", "most homeowners" |
| BL-B3 | "you will save", "you could save $X", "estimated savings", "potential savings" as a dollar figure |
| BL-B4 | "keep 100% of your savings" (implies savings) |
| BL-B5 | "guaranteed", "guarantee", "risk-free", "no risk" (outside `CC-12`'s negated form) |
| BL-B6 | "a X% reduction means a X% lower bill" or any 1:1 assessment-to-bill equivalence |
| BL-B7 | testimonials or outcome anecdotes of any kind until verified, consented, and documented |

### BL-C — Merits characterisation (severity: HIGH)

| ID | Banned |
|---|---|
| BL-C1 | "strong case", "solid case", "you have a case", "good comps", "strong comps" |
| BL-C2 | "worth appealing", "you should appeal", "we recommend appealing" |
| BL-C3 | "likely overpaying", "you're overassessed", "you're overpaying", "unfairly assessed" (as a finding about the user) |
| BL-C4 | any probability, score, grade, star, gauge, percentile, or ordinal rendering of the four states |
| BL-C5 | "the only thing the Board of Review actually reads" or any claim about what a public body reads, wants, or considers |

### BL-D — Freshness / deadline (severity: HIGH)

| ID | Banned |
|---|---|
| BL-D1 | any countdown not computed from render time against a source-stamped official date |
| BL-D2 | "checked regularly", "always current", "up to date", "public-record backed" as unqualified freshness claims |
| BL-D3 | "no grace period", "late filings are not accepted" attached to any non-official-feed date |
| BL-D4 | any deadline rendered without `CC-08`'s source + retrieval timestamp |
| BL-D5 | "internal modeling" as a source line on a consumer-facing deadline |

### BL-E — Eligibility / geography (severity: HIGH)

| ID | Banned |
|---|---|
| BL-E1 | any neighbourhood name used to establish township, deadline, or eligibility |
| BL-E2 | implying condo, multi-unit, or commercial coverage while scope is class 2 residential single-PIN |
| BL-E3 | implying coverage outside Cook County |

### BL-F — Required positives (must be present)

| ID | Must appear |
|---|---|
| BL-F1 | `CC-02` verbatim on every free-check result surface |
| BL-F2 | `CC-12` on every consumer surface |
| BL-F3 | `CC-10` wherever $69 appears |
| BL-F4 | `CC-08` wherever any date appears |
| BL-F5 | `CC-11` wherever the Board of Review is named |
| BL-F6 | exactly one "OverTaxed IL" in every `<title>` |
