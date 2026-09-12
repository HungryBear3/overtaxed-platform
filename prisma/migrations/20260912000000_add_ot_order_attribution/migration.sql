-- OT acquisition attribution — durable, immutable, privacy-bounded first touch.
--
-- ADDITIVE ONLY. This migration creates ONE new table and touches nothing that
-- is already deployed: no column is added to, altered on, or removed from
-- `ot_order`, no settlement/payment state is read or written, and no row is
-- backfilled. It is deliberately NOT reflected in prisma/schema.prisma — that
-- file is owned elsewhere — so this table is reached only through the
-- parameterized raw SQL helper in lib/attribution/record.ts.
--
-- NOT EXECUTED by the change that added it. See ATTRIBUTION-SCOPE.md.
--
-- ACCESS ASSUMPTIONS
--   * The application connects as the same role that owns the existing OT
--     tables; no new role, grant, or RLS policy is introduced here. If RLS is
--     enabled cluster-wide (see prisma/enable_rls.sql), this table must be
--     added there in the same style before it is used from a restricted role.
--   * The application issues exactly two statements against this table:
--     an `INSERT ... ON CONFLICT DO NOTHING` and a single-row `SELECT`, both
--     parameterized. It never issues UPDATE or DELETE.
--   * Deletion is reachable only as a cascade from `ot_order`, so an order and
--     its attribution cannot drift apart.

CREATE TABLE "ot_order_attribution" (
    -- One row per canonical order. The PK is the FK: this is what makes the
    -- binding one-to-one and makes `ON CONFLICT ("order_id") DO NOTHING` the
    -- complete expression of "first touch wins".
    "order_id" TEXT NOT NULL,

    -- NULL/NULL is the explicit ORGANIC sentinel: the first touch carried no
    -- approved campaign. Organic has to be a real row rather than the absence
    -- of one, because absence is indistinguishable from "not yet bound" and a
    -- later retry carrying a campaign code would then bind it — an upgrade on
    -- retry, which is exactly what this table exists to prevent.
    "campaign_code" TEXT,
    "creative_code" TEXT,

    -- Which approved set made the acceptance decision, for later audit of a
    -- code that has since been withdrawn from the registry.
    "registry_version" TEXT NOT NULL,

    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_order_attribution_pkey" PRIMARY KEY ("order_id")
);

ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "ot_order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The privacy boundary, re-asserted in the database.
--
-- Codes are lowercase alphanumerics and underscores, 2-40 chars. The charset is
-- the point: an email needs '@', a URL needs ':' and '/', a street address
-- needs spaces and commas, and none of those can be stored in these columns
-- even if the application layer were bypassed. This is a shape floor, not an
-- acceptance rule — acceptance is registry membership, enforced in
-- lib/attribution/registry.ts, which is the single source of truth for WHICH
-- codes are approved. Duplicating the approved list as SQL would create a
-- second source that silently drifts.
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_code_shape" CHECK (
        ("campaign_code" IS NULL OR "campaign_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND ("creative_code" IS NULL OR "creative_code" ~ '^[a-z0-9][a-z0-9_]{1,39}$')
        AND "registry_version" ~ '^[a-z0-9][a-z0-9_-]{1,79}$'
    );

-- A creative is meaningless without the campaign it ran under, and a row with
-- only a creative would read as a half-bound attribution. Organic is both NULL.
ALTER TABLE "ot_order_attribution"
    ADD CONSTRAINT "ot_order_attribution_creative_requires_campaign" CHECK (
        "creative_code" IS NULL OR "campaign_code" IS NOT NULL
    );

-- Immutability, enforced rather than assumed.
--
-- The application never issues an UPDATE against this table, but "we don't do
-- that" is a convention, and the guarantee being made -- that a retry can never
-- overwrite or upgrade an original first touch, INCLUDING an original organic
-- one -- is worth more than a convention. DELETE is intentionally not blocked:
-- it is reachable only by cascade from `ot_order`.
CREATE OR REPLACE FUNCTION "ot_order_attribution_reject_update"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ot_order_attribution rows are immutable (order_id=%)', OLD."order_id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ot_order_attribution_no_update"
    BEFORE UPDATE ON "ot_order_attribution"
    FOR EACH ROW EXECUTE FUNCTION "ot_order_attribution_reject_update"();

-- Reporting will group by campaign long before it looks up a single order, and
-- the PK does not serve that. Partial: organic rows are the sentinel, not a
-- campaign, and indexing them would be indexing the default.
CREATE INDEX "ot_order_attribution_campaign_code_idx"
    ON "ot_order_attribution"("campaign_code")
    WHERE "campaign_code" IS NOT NULL;
