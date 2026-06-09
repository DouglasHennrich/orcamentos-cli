# Implementation Plan: Threshold Discount Rule

**Branch**: `002-threshold-discount-rule` | **Date**: 2026-06-09 | **Spec**: [spec.md](spec.md)

## Summary

Adds a `threshold-discount` rule type to the product rules system. Rules are global per provider: any product meeting the minimum box count receives the configured discount percentage, overriding the platform's automatic discount. Multiple tiers per provider are supported; when multiple tiers match, the highest discount_pct wins. `override-discount` always takes priority.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+

**Primary Dependencies**: `enquirer` (UI), `node:sqlite` (persistence)

**Storage**: SQLite (`aliases.db`, `product_rules` table — reset on constructor)

**Testing**: Vitest

**Project Type**: CLI

**Performance Goals**: N/A (local SQLite, synchronous queries)

**Constraints**: No migration — table is dropped and recreated

## Constitution Check

*GATE: Passed.*

- Core logic in `src/db/` and `src/orcamento/orchestrator.ts` — decoupled from UI.
- Tests added for all new discount evaluation paths.
- No new external dependencies required.

## Project Structure

### Documentation

```text
specs/002-threshold-discount-rule/
├── spec.md               # Feature specification
├── plan.md               # This file
├── research.md           # Technical decisions
├── data-model.md         # Schema change and discount logic
├── contracts/
│   └── cli-contracts.md  # Rules editor new option
└── tasks.md              # Implementation tasks
```

### Source Code (modified files only)

```text
src/
├── db/
│   ├── schema.ts                    # MODIFY: DROP + new UNIQUE constraint
│   └── product-rule-repository.ts   # MODIFY: type union, save() conflict key
├── orcamento/
│   └── orchestrator.ts              # MODIFY: threshold log + discount loop
└── cli/
    └── rules-editor.ts              # MODIFY: new type, create/edit/display flows

tests/
└── orcamento/
    └── orchestrator.test.ts         # ADD: 6 new threshold-discount test cases
```

## Phases

### Phase 1: Schema & Repository

1. **`src/db/schema.ts`**:
   - Add `DROP TABLE IF EXISTS product_rules;` before `CREATE TABLE IF NOT EXISTS`
   - Change `UNIQUE(provider, type, product_code)` → `UNIQUE(provider, type, product_code, quantity_value)`

2. **`src/db/product-rule-repository.ts`**:
   - Extend `type` union: `'add-product' | 'override-discount' | 'threshold-discount'`
   - Update `save()` conflict target: `ON CONFLICT(provider, type, product_code, quantity_value)`
   - `mapRowToRule()` already handles arbitrary string cast — no change needed

### Phase 2: Orchestrator

3. **`src/orcamento/orchestrator.ts`**:
   - Rule log block: add `threshold-discount` tier display (grouped, sorted asc by `quantity_value`, `interactive` only)
   - Discount loop: after override check, before platform auto, add threshold evaluation

### Phase 3: Rules Editor

4. **`src/cli/rules-editor.ts`**:
   - Add `threshold-discount` choice to type Select in `addRule()`
   - `threshold-discount` branch: skip product code/name/units_per_box prompts; ask min_boxes (validate >= 1) and discount_pct (validate 1–100)
   - Rule list display: handle `threshold-discount` format `Desconto por quantidade: >=N cx -> M%`
   - `editRule()`: add `threshold-discount` branch showing min_boxes + discount_pct
   - `pickRule()`: display `threshold-discount` rules with their threshold instead of product_code

### Phase 4: Tests

5. **`tests/orcamento/orchestrator.test.ts`**: Add 6 test cases:
   - Boundary inclusive: product with exactly `quantity_value` boxes → threshold discount applied
   - Below threshold: product with fewer boxes → platform auto-discount
   - Multi-tier highest wins: two tiers, product qualifies for both → highest discount_pct
   - Override priority: `override-discount` for specific product wins over matching threshold
   - Override unaffected: product with override-discount ignores threshold rules
   - No match, no override: falls through to platform auto-discount
