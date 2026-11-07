# What the county's proration fields mean, for the free check

Status: engineering decision, Nov 6 2026. Applies to `lib/fulfillment-runtime/free-eligibility.ts` only. The paid report's `parcelJoinRefusal` is unchanged and still refuses these rows.

## Source of the published values

`x54s-btds` (Assessor - Residential Single and Multi-Family Improvement Characteristics) is built from `open_data.vw_sf_mf_improvement_char`, a copy of `default.vw_card_res_char`, both published by the Assessor's Data Department in `ccao-data/data-architecture` at commit `4bd2d19b9f096ffbe1550440145669fd84753672`. `dbt/models/open_data/exposures.yml` binds asset `x54s-btds` to that view with primary key `pin`, `card`.

```sql
par.tieback AS tieback_key_pin,
CASE
    WHEN par.tiebldgpct IS NOT NULL THEN par.tiebldgpct / 100.0
    ELSE 1.0
END AS tieback_proration_rate,
CASE
    WHEN dwel.taxyr < '2024' THEN CAST(dwel.user24 AS DOUBLE) / 100 ELSE
        COALESCE(dwel.external_propct, 0) / 100.0
END AS card_proration_rate,
```

SHA-256 of the fetched files:
- `default.vw_card_res_char.sql`: `6308be44320072c4afc854e1387e59bcf6aa8eb6b223fed302de4ee4057ec306`

The Socrata metadata (`/api/views/x54s-btds.json`, `provenance: official`) describes both rates as multipliers of assessed value and does not say what 0.0 means. The SQL does. `shared_columns.md` adds that proration applies "when not all of their value is contained within their boundaries", for example 50% for a building lying across two PINs, and that `external_propct` is the maintained card column from 2024.

## Reading

For tax year 2024 and later:

| `tieback_proration_rate` | `card_proration_rate` | Meaning | Free check |
|---|---|---|---|
| 1.0 | 0.0 | No tie-back percent and no card percent recorded. 0.0 is the `COALESCE` default, not a zero share. | Whole building |
| 1.0 | 1.0 | Card percent recorded as 100. | Whole building |
| below 1 | any | A share of a building spanning PINs. | Excluded |
| 1.0 | strictly between 0 and 1, or above 1 | A share at card level, or an undocumented value. | Excluded |
| 0.0 | any | A stored 0 percent: `tiebldgpct` was not null, so this is not the default. | Excluded |
| blank | any | The view cannot produce a blank. Unknown, not whole. | Excluded |
| any | blank | Same. | Excluded |

A `tieback_key_pin` naming the parcel itself is fine at unit rates. One naming another parcel is excluded regardless of rates.

Observed on Nov 6 2026 across 1,350 retained rows in 7 neighborhood reads: 1.0 / 0.0 on 1,314 rows, and every other row carried the same fractional value on both fields with a tie-back key, which matches this reading.

## Residual risk

`COALESCE` erases one distinction: a card whose `external_propct` is literally 0 publishes the same 0.0 as a card with none. Nothing public separates them. It is accepted because the PIN-level rate is 1.0 and no foreign tie-back exists on such a row, and the observed prorated rows all populate both fields. The county has not confirmed this reading in writing.

A subject row may never be excluded: if the subject fails any of these, the free check shows no comparison.
