# Tasks: Threshold Discount Rule

**Input**: Design documents from `specs/002-threshold-discount-rule/`

**Prerequisites**: plan.md ✓ | spec.md ✓ | research.md ✓ | data-model.md ✓ | contracts/ ✓

---

## Phase 1: Foundational (Schema & Repository)

**Purpose**: Break the schema barrier — required before any user story can be tested end-to-end.

**Independent Test**: `ProductRuleRepository` accepts two `threshold-discount` rows for the same provider with different `quantity_value` without throwing UNIQUE constraint errors.

- [ ] T001 Add `DROP TABLE IF EXISTS product_rules;` before `CREATE TABLE` in `src/db/schema.ts`
- [ ] T002 Change UNIQUE constraint from `UNIQUE(provider, type, product_code)` to `UNIQUE(provider, type, product_code, quantity_value)` in `src/db/schema.ts`
- [ ] T003 Extend `type` union to `'add-product' | 'override-discount' | 'threshold-discount'` in `src/db/product-rule-repository.ts`
- [ ] T004 Update `save()` conflict target from `ON CONFLICT(provider, type, product_code)` to `ON CONFLICT(provider, type, product_code, quantity_value)` in `src/db/product-rule-repository.ts`

---

## Phase 2: US1 — Single Tier Discount Application

**Story Goal**: A user creates one threshold-discount rule and any product meeting the minimum box count receives the configured discount instead of the platform's automatic discount.

**Independent Test**: Create a `threshold-discount` rule (>=10 cx -> 15%), run a quote with a product at exactly 10 boxes, confirm 15% discount applied; run with 9 boxes, confirm platform auto-discount.

- [ ] T005 [US1] Add threshold-discount evaluation to discount loop in `src/orcamento/orchestrator.ts` (after override check, before platform auto): filter rules where `type === 'threshold-discount' && quantityValue !== undefined && b >= quantityValue`, sort descending by `discountPct`, apply highest match
- [ ] T006 [US1] Add `threshold-discount` option to type Select in `addRule()` in `src/cli/rules-editor.ts`: label "Desconto por Quantidade (Global, por nivel de caixas)"
- [ ] T007 [US1] Add `threshold-discount` creation branch in `addRule()` in `src/cli/rules-editor.ts`: skip product code/name/units_per_box prompts; ask min_boxes (validate >= 1, error: "Minimo deve ser um numero inteiro maior que 0") and discount_pct (validate 1-100); store productCode='*', quantityUnit=undefined, productName=undefined
- [ ] T008 [US1] Update rule list display in `runRulesEditor()` main loop in `src/cli/rules-editor.ts`: handle `threshold-discount` type with format `Desconto por quantidade: >=N cx -> M%`
- [ ] T009 [US1] Write test: product with exactly `quantity_value` boxes receives threshold discount (boundary inclusive) in `tests/orcamento/orchestrator.test.ts`
- [ ] T010 [US1] Write test: product below threshold receives platform auto-discount in `tests/orcamento/orchestrator.test.ts`

---

## Phase 3: US2 — Multiple Discount Tiers

**Story Goal**: Multiple tiers exist for the same provider; each product independently receives the highest discount for which it qualifies.

**Independent Test**: Create two rules (>=5 cx -> 10%, >=10 cx -> 15%); product with 12 boxes gets 15%; product with 7 boxes gets 10%.

- [ ] T011 [P] [US2] Write test: two tiers match, highest discount_pct wins in `tests/orcamento/orchestrator.test.ts`
- [ ] T012 [P] [US2] Write test: only lower tier matches (product between tiers) in `tests/orcamento/orchestrator.test.ts`
- [ ] T013 [US2] Update `pickRule()` display in `src/cli/rules-editor.ts` to show `threshold-discount` rules as `>=N cx -> M%` instead of product code
- [ ] T014 [US2] Add `threshold-discount` edit branch in `editRule()` in `src/cli/rules-editor.ts`: show min_boxes and discount_pct fields only; validate same as creation

---

## Phase 4: US3 — Override-Discount Priority

**Story Goal**: Products with an explicit `override-discount` rule are never affected by threshold rules, regardless of box count.

**Independent Test**: With both override-discount (product ABC -> 5%) and threshold rule (>=10 cx -> 15%) active, product ABC at 15 boxes receives 5%.

- [ ] T015 [P] [US3] Write test: override-discount for specific product takes priority over matching threshold in `tests/orcamento/orchestrator.test.ts`
- [ ] T016 [P] [US3] Write test: product with no override and no matching threshold falls through to platform auto-discount in `tests/orcamento/orchestrator.test.ts`

---

## Final Phase: Polish & Cross-Cutting

**Purpose**: Logging, run all tests, TypeScript build check.

- [ ] T017 Add threshold-discount tier log to rule logging block in `src/orcamento/orchestrator.ts` (interactive only): group all tiers for provider, sort asc by `quantityValue`, format `DESCONTO POR QUANTIDADE: >=5 cx -> 10%, >=10 cx -> 15%`
- [ ] T018 Run `npm test` and confirm all tests pass (including existing tests)
- [ ] T019 Run `npx tsc --noEmit` and confirm zero TypeScript errors

---

## Dependencies

```
T001 -> T002 -> T003 -> T004   (foundational, sequential)
T004 -> T005                   (discount loop needs correct schema)
T004 -> T006 -> T007 -> T008   (editor needs correct type union)
T005 -> T009, T010             (tests validate orchestrator logic)
T005 -> T011, T012             (multi-tier tests)
T005 -> T015, T016             (priority tests)
T017 -> T018 -> T019           (polish before final build check)
```

## Parallel Opportunities

- T011, T012, T015, T016 can all be written in parallel (different test cases, same file)
- T006-T008 (editor) and T005 (orchestrator) can proceed in parallel after T004

## Implementation Strategy

**MVP (US1 only)**: T001-T010 delivers a working single-tier threshold discount. Can be demoed immediately.

**Full delivery**: T011-T019 adds multi-tier support, override priority tests, and polished logging.
