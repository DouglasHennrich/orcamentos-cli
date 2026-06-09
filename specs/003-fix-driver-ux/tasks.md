# Tasks: Driver UX Flow Hardening + Dry-Run Validation

**Input**: Driver UX flow design for AutoAmerica and Roberlo

**Branch**: `003-fix-driver-ux`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel with other tasks
- **[Story]**: US1 = AutoAmerica header flow, US2 = product resolution UX, US3 = dry-run and line persistence

---

## Phase 1: AutoAmerica Header and Line Validation (US1)

- [ ] T001 [US1] `src/platforms/autoamerica-driver.ts` — update `selectPriceTable(code)` to set `#CJ_TABELA`, call `.trigger('change')`, call `selProd()`, wait for `CK_PRODUTO01`, then apply `CJ_TPFRETE`, `CJ_XTRANSP`, `CJ_XTPORC`, `CJ_XMODALI = 001`, `CJ_FRETE = 0,00`, `recFrete()`, and finally `CJ_CONDPAG = 031` with UI stability waits between stages.
- [ ] T002 [US1] `src/platforms/autoamerica-driver.ts` — update `addLine(productCode, units)` to fill product row, set quantity, call `VldQtd(n)`, `TotalItem(n)`, `VldValor(n)`, and wait for item total calculation before returning.

---

## Phase 2: Roberlo Stability Reinforcement (US1)

- [P] [US1] T003 `src/platforms/roberlo-driver.ts` — confirm `selectPriceTable(code)` waits for the product list load, only applies freight/header setters after load, and awaits `blockUI` clearance after the final blur/change.

---

## Phase 3: Dry-Run and Orchestration Safety (US3)

- [ ] T004 [US3] `src/orcamento/orchestrator.ts` — ensure `runOrcamento({ dryRun: true })` skips `driver.save()`, skips `driver.exportQuote()`, does not call `exportWriter`, and returns `exportPath: '(simulação)'` while still returning `total` and `parcelas`.
- [ ] T005 [US3] `src/orcamento/orchestrator.ts` — add safe handling for `driver.addLine()` failures: log origin and error, continue other products, and exclude failed products from discount/box aggregation.

---

## Phase 4: Product Resolution UX Cleanup (US2)

- [P] [US2] T006 `src/io/prompt.ts` — remove "0) Nenhum / buscar de novo" from `ConsolePrompter.choose()` display while preserving `n === 0` → `null` behavior.
- [P] [US2] T007 `src/orcamento/resolver.ts` — remove extra alias collection from interactive resolution; save aliases only as `[line.name]`.

---

## Phase 5: Tests and Verification

- [ ] T008 `tests/orcamento/orchestrator.test.ts` — add dry-run coverage verifying no save/export, no exportWriter call, and `exportPath` is `(simulação)`.
- [ ] T009 `tests/orcamento/orchestrator.test.ts` — add a failure-path test for `driver.addLine()` returning error and confirm remaining products continue, failure is logged, and failed line is excluded from discount logic.
- [ ] T010 `tests/resolver.test.ts` — assert the interactive resolution path does not ask for extraneous aliases and records origin correctly if `resolvedFrom` is used.
- [ ] T011 `tests/prompt.test.ts` (or equivalent) — assert `choose()` output no longer includes the removed option text.
- [ ] T012 Manual validation — run `agent-orcamento run -o <pedido>.json --dry-run` for AutoAmerica and Roberlo to confirm full simulated flow.

---

## Ordering and Parallelism

1. `T001`, `T002` — fix AutoAmerica sequence and line validation first.
2. `T003`, `T006`, `T007` — can proceed in parallel once the driver UX and prompt UX shape is defined.
3. `T004`, `T005` — implement dry-run safety and error handling after the driver changes are clear.
4. `T008`–`T011` — add tests once behavior is implemented.
5. `T012` — manual CLI validation after code and tests pass.

## Acceptance Checks

- `T001` and `T002` produce a stable AutoAmerica quote flow with header fields applied after product load and native validation functions called in correct order.
- `T003` improves Roberlo table header stability without changing existing selection semantics.
- `T004` makes `dryRun` a true simulation path.
- `T006` and `T007` remove UX friction from product resolution.
- `T008` and `T009` verify the new behavior in automated coverage.
