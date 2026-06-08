# Implementation Plan: Batch Paralelo e Regras de Produtos

**Branch**: `001-batch-paralelo-regras-produtos` | **Date**: 2026-06-08 | **Spec**: [spec.md](spec.md)

## Summary

This feature transitions the CLI from single-budget execution to a multi-provider batch processing system. It removes the `--platform` flag from the `run` command, relying on the JSON input to specify providers. Additionally, it introduces a "Product Rules" system to automate repetitive tasks like adding mandatory items or forcing specific discounts for each provider, managed via a new interactive `rules` sub-command.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+

**Primary Dependencies**: 
- `commander` (CLI)
- `enquirer` (Interactivity)
- `better-sqlite3` (Persistence)
- `p-limit` (Concurrency control)
- `cli-table3` (Batch summaries)

**Storage**: SQLite (`aliases.db` will host the new `product_rules` table)

**Testing**: Vitest (Unit & Integration)

**Project Type**: CLI

## Constitution Check

*GATE: Passed.*

- **Library-First**: Core logic for rules and batching will be decoupled inside `src/orcamento` and `src/db`.
- **Test-First**: Unit tests for repo and orchestrator logic will be written before implementation.
- **Interface**: Maintain Text/JSON I/O protocols.

## Project Structure

### Documentation

```text
specs/001-batch-paralelo-regras-produtos/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Technical analysis of concurrency and persistence
├── data-model.md        # Database schema for product rules
├── contracts/
│   └── api-contracts.md # CLI and service interface changes
└── tasks.md             # Implementation tasks
```

### Source Code

```text
src/
├── cli/
│   ├── index.ts              # Command updates and batch logic
│   └── rules-editor.ts       # NEW: Interactive rules manager
├── db/
│   ├── product-rule-repository.ts # NEW: Rule persistence
│   └── schema.ts             # Updated with table creation
├── orcamento/
│   ├── orchestrator.ts       # Updated for rules injection and non-interactive mode
│   └── batch-runner.ts       # NEW: Batch execution logic
└── platforms/
    └── types.ts              # Type updates
```

## Phases

### Phase 1: Persistence & Data Model
- Create `product-rule-repository.ts`.
- Update `schema.ts` to include `product_rules` table.
- Implement CRUD for rules.

### Phase 2: Rules Injection Logic
- Update `orchestrator.ts` to load rules before processing lines.
- Implement merging logic for `add-product`.
- Implement override logic for `override-discount`.
- Add `interactive` flag to handle batch vs single mode.

### Phase 3: Batch Parallelism
- Refactor `src/cli/index.ts` to support JSON arrays.
- Implement `BatchRunner` with `p-limit` for concurrencyControl.
- Update `parseOrder` to validate provider mandatory field.

### Phase 4: Interactive Rules Editor
- Implement `rules` sub-command.
- Create step-by-step wizard for rule creation.
- Add listing and management interface.

### Phase 5: Verification & Polish
- Update `pedido.example.json`.
- Add overall batch summary table output.
- Final integration tests.
