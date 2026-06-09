# Data Model: Threshold Discount Rule

**Branch**: `002-threshold-discount-rule` | **Date**: 2026-06-09

## Table: `product_rules` (modified)

No new columns. Schema change is the UNIQUE constraint only.

```sql
-- Before
UNIQUE(provider, type, product_code)

-- After  
UNIQUE(provider, type, product_code, quantity_value)
```

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| provider | TEXT NOT NULL | 'autoamerica' \| 'roberlo' |
| type | TEXT NOT NULL | 'add-product' \| 'override-discount' \| **'threshold-discount'** |
| product_code | TEXT NOT NULL | '*' for threshold-discount; specific code for others |
| product_name | TEXT | NULL for threshold-discount |
| units_per_box | INTEGER | NULL for threshold-discount |
| quantity_value | INTEGER | Min boxes for threshold-discount; quantity for add-product; NULL for override-discount |
| quantity_unit | TEXT | NULL for threshold-discount |
| discount_pct | INTEGER | 1–100 for threshold-discount; 0–100 for override-discount |
| enabled | INTEGER NOT NULL DEFAULT 1 | boolean (0/1) |
| created_at | TEXT NOT NULL | ISO 8601 string |

## threshold-discount row example

| provider | type | product_code | quantity_value | discount_pct |
|----------|------|--------------|----------------|--------------|
| autoamerica | threshold-discount | * | 5 | 10 |
| autoamerica | threshold-discount | * | 10 | 15 |

## TypeScript interface change

```ts
// Before
type: 'add-product' | 'override-discount'

// After
type: 'add-product' | 'override-discount' | 'threshold-discount'
```

## Discount Priority Logic

```
for each product line (post-bump):
  b = boxes.get(productCode) ?? 0

  1. override = rules.find(r => r.type === 'override-discount' && r.productCode === l.productCode)
     if override → applyDiscount(productCode, override.discountPct); continue

  2. thresholdMatches = rules
       .filter(r => r.type === 'threshold-discount' && r.quantityValue !== undefined && b >= r.quantityValue)
       .sort(desc by discountPct)
     if thresholdMatches.length > 0 → applyDiscount(productCode, thresholdMatches[0].discountPct); continue

  3. platform auto-discount (existing logic)
```
