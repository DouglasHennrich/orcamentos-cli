# Tasks: Batch Paralelo e Regras de Produtos

## Phase 1: Persistence & Data Model [P]
- [ ] [PR-001] Update `src/db/schema.ts` to include `product_rules` table with unique constraint on `(provider, type, product_code)`.
- [ ] [PR-002] Create `src/db/product-rule-repository.ts` with `CRUD` operations and `listByProvider` method.
- [ ] [PR-003] Implement unit tests for `ProductRuleRepository` in `src/db/product-rule-repository.test.ts`.

## Phase 2: Rules Injection Logic [P]
- [ ] [RL-001] Update `src/orcamento/orchestrator.ts` to load enabled rules for the specific provider before processing.
- [ ] [RL-002] Implement logic in `Orchestrator` to inject `add-product` rules into the order items (summing quantity if already present).
- [ ] [RL-003] Implement logic in `Orchestrator` to apply `override-discount` rules to matches during resolution.
- [ ] [RL-004] Update `Orchestrator` to accept an `interactive` flag and suppress prompts in batch mode (FR-010a).
- [ ] [RL-005] Add unit tests for rules injection logic in `src/orcamento/orchestrator.test.ts`.

## Phase 3: Batch Parallelism [P]
- [ ] [BP-001] Update `Order` type and `parseOrder` in `src/orcamento/order.ts` to validate mandatory `provider` field.
- [ ] [BP-002] Create `src/orcamento/batch-runner.ts` to handle parallel execution using `p-limit` and capture per-order results.
- [ ] [BP-003] Update `src/cli/index.ts` to remove `--platform` flag from `run` command and support JSON arrays in `-o/--order` flag.
- [ ] [BP-004] Implement `BatchRunner` integration into the `run` command.
- [ ] [BP-005] Update `src/platforms/agent-browser-runner.ts` to ensure clean environment isolation for parallel browser instances.
- [ ] [BP-006] Implement integration tests for batch execution in `src/orcamento/batch-runner.test.ts`.

## Phase 4: Interactive Rules Editor [P]
- [ ] [RE-001] Add `rules` subcommand to `src/cli/index.ts`.
- [ ] [RE-002] Implement `src/cli/rules-editor.ts` using `enquirer` for the interactive wizard (select provider -> action -> fields).
- [ ] [RE-003] Implement rules listing with status indicators (Enabled/Disabled) and formatting.
- [ ] [RE-004] Implement confirmation prompts for deletion and critical edits.

## Phase 5: Verification & Polish [P]
- [ ] [VP-001] Update `pedido.example.json` to the new format (array of objects with `provider`).
- [ ] [VP-002] Implement final summary table using `cli-table3` at the end of batch execution.
- [ ] [VP-003] Update `CLAUDE.md` and documentation files to reflect new CLI commands and JSON format.
- [ ] [VP-004] Final end-to-end manual verification of the complete workflow.
