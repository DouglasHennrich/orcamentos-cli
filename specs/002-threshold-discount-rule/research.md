# Research: Threshold Discount Rule

**Branch**: `002-threshold-discount-rule` | **Date**: 2026-06-09

## Decision: Schema Reset Strategy

**Decision**: Drop and recreate `product_rules` table in `ProductRuleRepository` constructor.

**Rationale**: The constructor already calls `db.exec(CREATE_PRODUCT_RULES)`. Adding `DROP TABLE IF EXISTS product_rules` before it costs nothing and avoids migration complexity. Acceptable because the table is always re-populated from user-managed rules.

**Alternatives**: SQLite `ALTER TABLE` to modify constraint — not possible for UNIQUE changes without recreating the table.

---

## Decision: Conflict Key for `save()` Upsert

**Decision**: Change `ON CONFLICT(provider, type, product_code)` to `ON CONFLICT(provider, type, product_code, quantity_value)`.

**Rationale**: For `threshold-discount`, `product_code` is always `'*'` — the tier is distinguished only by `quantity_value`. SQLite treats NULLs as distinct in UNIQUE indexes, so `override-discount` rows (where `quantity_value` is NULL) are never accidentally merged by the new constraint.

**Verified**: SQLite docs: "NULL values are considered distinct from all other values, including other NULLs, for purposes of UNIQUE."

---

## Decision: Box Count Timing for Threshold Evaluation

**Decision**: Evaluate thresholds using the **post-bump** box count from the `boxes` Map.

**Rationale**: The `boxes` Map is updated during the minimum-value loop. By the time the discount loop runs, `boxes.get(l.productCode)` holds the final count. This is the same `b` variable the current override-discount check already uses.

---

## Decision: Logging Format for Threshold Tiers

**Decision**: Group all threshold tiers for a provider into one log line sorted by `quantity_value` ascending.

**Format**: `DESCONTO POR QUANTIDADE: >=5 cx -> 10%, >=10 cx -> 15%`

---

## Decision: Zero Discount Validation

**Decision**: `discount_pct = 0` is invalid for `threshold-discount`. Validation requires value >= 1.

**Rationale**: A 0% threshold-discount would silently disable platform auto-discount with no effect. The spec's Key Entities section specifies `discount_pct` as integer 1–100 for threshold rules.
