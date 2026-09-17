# OT neutral Phase 3 native PostgreSQL acceptance — 2026-09-15

Local-only evidence. No Production database, Stripe, Blob, deployment, customer, delivery, or refund action occurred.

- PostgreSQL: fresh disposable local PostgreSQL 18.x instance, stopped after acceptance.
- Migrations: all 33 repository migrations applied from zero with `prisma migrate deploy`.
- Identities: privileged migration owner, separate application login inheriting only the read-only `ot_neutral_app_reader` neutral authority role, and separate restricted neutral login inheriting only the non-login `ot_neutral_runtime` role.
- Preflight: all three identities connected to the same database; Phase 3 tables existed; forced RLS and non-runtime ownership were verified; required column/table grants were present; DELETE and other excessive privileges were absent.
- Native tests: Phase 2 reservation acceptance and Phase 3 QA/delivery acceptance both passed in one run with `--runInBand --detectOpenHandles`.
- Phase 3 behavior: idempotent/conflict-safe QA opening, a true concurrent payment-reversal-versus-approval race that always converges to database-enforced `HELD`, narrow-RLS capability revocation plus a native `CAPABILITY_REVOKED` download decision, the serialized 25-opened/reviewed-order weekly cap (the 26th open is refused), the trusted-clock 20-minute hard stop, durable `REFUND_REQUIRED` without a Stripe mutation, operator claim and receipt recording followed by mocked read-only provider verification of the exact receipt/payment/$69 amount/required USD currency/succeeded status, real restricted-runtime customer ZIP promotion with deterministic fake storage, read-only application authority projection, reversal-before-promotion refusal, customer ZIP intent transitions, promoted-object corruption to `COMPROMISED`, and explicit supersession were exercised.
- External storage was replaced by a deterministic failing fake for the corruption test; no network or object-storage operation occurred.
- Earlier native failures exposed over-broad row locks on read-only global commerce sources. The final promotion flow uses an order-scoped advisory transaction lock, locks only neutral-owned rows, and re-reads order/payment/reversal and fulfillment/artifact authority through bounded SELECT grants.
- Phase 3 migration SHA-256: `0fa316caf8b70620fbc411180f87b40105b821287b14da62361bb05b7bdb4194`.

Connection values, local paths, row identifiers, and synthetic PINs are intentionally omitted. This is not Production acceptance.
