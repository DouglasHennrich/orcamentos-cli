# Threshold Discount Rule — Design Spec

**Date:** 2026-06-09  
**Status:** Approved

---

## Context

The `product_rules` system currently supports two rule types:

- `add-product`: always includes a product in the quote with a fixed quantity.
- `override-discount`: always applies a fixed discount % to a specific product, overriding the platform's automatic calculation.

The problem: to apply discounts by quantity, the user would need to create one `override-discount` rule per product — which is impractical when the discount criteria is the same for all products ("any product with >= X boxes gets Y% off").

---

## Goal

Add a new rule type `threshold-discount` that applies a discount to **any product** in the quote when the product's box count meets or exceeds a configured minimum. Multiple tiers can be created per provider (e.g., ≥5 cx → 10%, ≥10 cx → 15%), and each product is evaluated independently.

---

## Rule Behavior

- The rule is **global per provider** — it applies to all products in the quote, not a specific one.
- The threshold is **inclusive**: a product with exactly `quantity_value` boxes qualifies.
- When multiple threshold rules match a product (boxes >= multiple thresholds), the one with the **highest `discount_pct`** is applied.
- `override-discount` always takes precedence over `threshold-discount` for a specific product.
- When a threshold rule applies, it **replaces** the platform's automatic discount (same behavior as `override-discount`).
- If no threshold matches and no `override-discount` exists, the platform's automatic discount runs as usual.

### Priority order for discounts

1. `override-discount` for the specific `product_code` → applies, stops.
2. `threshold-discount` rules where `boxes >= quantity_value` → applies the highest matching `discount_pct`, stops.
3. Platform automatic discount (current behavior).

---

## Schema Changes

**Files:** `src/db/schema.ts`, `src/db/product-rule-repository.ts`

The `product_rules` table is **dropped and recreated** when `ProductRuleRepository` is instantiated (its constructor already calls `db.exec(CREATE_PRODUCT_RULES)`; a `DROP TABLE IF EXISTS product_rules` will be added before it). No migration needed — table reset is acceptable. The only structural change is the UNIQUE constraint:

```sql
-- Before
UNIQUE(provider, type, product_code)

-- After
UNIQUE(provider, type, product_code, quantity_value)
```

This allows multiple rows for the same provider + type combination as long as `quantity_value` differs (enabling multiple tiers).

For `threshold-discount` rules, `product_code` is stored as the sentinel value `'*'` (meaning "all products"). `quantity_unit` is not used and stored as `NULL`.

No new columns are needed. The existing `quantity_value` and `discount_pct` columns cover all requirements.

---

## Type Changes

**File:** `src/db/product-rule-repository.ts`

The `type` union is extended:

```ts
type: 'add-product' | 'override-discount' | 'threshold-discount'
```

No new repository methods are needed. `listByProvider` already returns all rules; threshold logic lives in the orchestrator.

---

## Orchestrator Changes

**File:** `src/orcamento/orchestrator.ts`

### Active rules log

Add display for `threshold-discount` rules at the top of the run, grouped by provider, showing all tiers:

```
- DESCONTO POR QUANTIDADE: ≥5 cx → 10%, ≥10 cx → 15%
```

### Discount application loop

Replace the current discount block with:

```
for each product line:
  b = boxes for this product

  1. find override = rules.find(r => r.type === 'override-discount' && r.productCode === line.productCode)
     if override → applyDiscount(productCode, override.discountPct); continue

  2. thresholdMatches = rules
       .filter(r => r.type === 'threshold-discount' && r.quantityValue !== undefined && b >= r.quantityValue)
       .sort by discountPct descending
     if thresholdMatches.length > 0 → applyDiscount(productCode, thresholdMatches[0].discountPct); continue

  3. platform auto-discount (existing logic)
```

---

## Rules Editor Changes

**File:** `src/cli/rules-editor.ts`

### New option in type selector

```
Tipo de regra:
  > Adicionar Produto (Sempre incluir)
    Desconto Fixo (Sobrescrever automático)
    Desconto por Quantidade (Global, por nível de caixas)  <- NEW
```

### Creation flow for `threshold-discount`

No product code prompt. Only:
1. "Mínimo de caixas:" (integer > 0)
2. "Percentual de desconto (0-100):" (integer 0-100)

Stores: `productCode = '*'`, `quantityValue = input`, `discountPct = input`, `quantityUnit = null`.

### Display in rule list

```
- [ATIVA] Desconto por quantidade: >=10 cx -> 15%
```

### Edit flow

Same fields as creation: min boxes and discount %. Product code (`'*'`) is not editable.

---

## Tests

The following test cases should be added to `tests/orcamento/orchestrator.test.ts`:

- Product with exactly `quantity_value` boxes receives the threshold discount (inclusive boundary).
- Product below threshold receives platform auto-discount.
- Multiple tiers: product qualifies for two thresholds, highest discount_pct wins.
- `override-discount` for a specific product takes priority over a matching threshold rule.
- Product with `override-discount` rule is unaffected by threshold rules.
- Product below all thresholds and with no override falls through to platform auto-discount.

---

## Out of Scope

- Per-product threshold rules (a `threshold-discount` targeting a specific `product_code`). All threshold rules are global.
- Stacking threshold discount on top of the platform auto-discount.
- UI for reordering or comparing tiers visually.
