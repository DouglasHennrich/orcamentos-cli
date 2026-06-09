# Implementation Plan: Driver UX Flow Hardening + Dry-Run Validation

**Branch**: `003-fix-driver-ux` | **Date**: 2026-06-09 | **Spec**: [spec.md](spec.md)

## Summary

Harden the AutoAmerica and Roberlo driver automation flows to avoid portal deadlocks and preserve field order during quote filling. Validate the complete run path in dry-run mode so the simulated budget exercise covers client selection, price table application, product line filling, and final totals without invoking persistence.

## Goal

- Prevent AutoAmerica from applying header values too early and resetting critical fields.
- Preserve the native Protheus/APW validation flow for AutoAmerica line addition.
- Enforce additional UI stability checks in Roberlo table selection.
- Confirm dry-run execution does not call `save()` or `exportQuote()` while still returning quote totals and parcelas.

## Affected Components

- `src/platforms/autoamerica-driver.ts`
- `src/platforms/roberlo-driver.ts`
- `src/orcamento/orchestrator.ts`
- `tests/orcamento/orchestrator.test.ts`

## Proposed Implementation

### AutoAmericaDriver

1. `selectPriceTable(code)` must:
   - set `#CJ_TABELA` and call `.trigger('change')`
   - call `selProd()`
   - wait until `CK_PRODUTO01` is loaded
   - then apply header fields in sequence:
     - `#CJ_TPFRETE`
     - `#CJ_XTRANSP`
     - `#CJ_XTPORC`
   - after the header sequence, apply:
     - `#CJ_XMODALI = 001`
     - `#CJ_FRETE = 0,00`
     - `recFrete()`
   - then initialize `#CJ_CONDPAG = 031`
   - wait for UI blocks to clear between each stage as needed

2. `addLine(productCode, units)` must:
   - load the product into the correct row
   - fill quantity only after the product row is ready
   - call `VldQtd(n)`, `TotalItem(n)` and `VldValor(n)` after quantity entry
   - wait for the per-item total to be calculated before returning success

### RoberloDriver

1. `selectPriceTable(code)` must keep existing logic but reinforce stability by:
   - waiting for the product list to load before applying freight/header fields
   - applying freight-related header setters only after page stabilization
   - waiting for `blockUI` to disappear after the final blur or change event

2. The current `CK_XTABELA` per-line and `U_GATPROD.APW` behavior remains aligned; the fix is stability and ordering only.

### Orchestration and Dry-Run Validation

- `runOrcamento()` already supports `dryRun` mode and must not call `save()` when enabled.
- Dry-run should also skip `exportQuote()` and return `exportPath: '(simulação)'.`
- The result must still include `total` and `parcelas` so the simulation is a full run validation.

## Verification Strategy

1. Update `tests/orcamento/orchestrator.test.ts` to cover dry-run behavior:
   - `driver.save()` and `driver.exportQuote()` are not called
   - `exportWriter` is not invoked
   - result contains correct `total` and `exportPath: '(simulação)'`

2. Add end-to-end-style assertions for line addition failure handling:
   - when `driver.addLine()` returns an error, the run continues for remaining products
   - failed products are not added to the discount/box map
   - final run output logs a failure summary

3. Validate manually using the CLI in `--dry-run` mode for both drivers:
   - `agent-orcamento run -o <pedido>.json --dry-run`
   - confirm AutoAmerica and Roberlo flows complete without save/export

## Risk Assessment

- The AutoAmerica sequence is portal-specific; `recFrete()` and `CJ_CONDPAG` ordering must be exact.
- Dry-run validation does not prove production save/export behavior, only the fill path.
- If the portal returns unexpected field names or callbacks, the new wait ordering may still require portal-specific tuning.

## Success Criteria

- `AutoAmericaDriver.selectPriceTable()` preserves the header flow and preconfigures `CJ_CONDPAG` after products are loaded.
- `AutoAmericaDriver.addLine()` follows the native portal validation sequence.
- `RoberloDriver.selectPriceTable()` waits for UI stability after header application.
- `runOrcamento({ dryRun: true })` simulates a full quote without calling persistence APIs and returns `exportPath: '(simulação)'.`

## Next Steps

1. Implement driver sequence fixes in `autoamerica-driver.ts` and `roberlo-driver.ts`.
2. Harden `runOrcamento()` around dry-run and add-line failure handling.
3. Extend `tests/orcamento/orchestrator.test.ts` with dry-run coverage and failure path assertions.
4. Validate manually via CLI for AutoAmerica and Roberlo dry-run execution.
