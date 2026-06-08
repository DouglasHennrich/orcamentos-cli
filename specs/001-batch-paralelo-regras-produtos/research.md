# Research: Batch Paralelo e Regras de Produtos

## Concurrency Management
- **Issue**: Each budget run opens a browser. 3 budgets = 3 browsers.
- **Approach**: Use a generic worker pool or a simple promise-limiting library (like `p-limit`).
- **Target**: Default concurrency = 3. Allow override via `--concurrency`.

## Data Consistency (Rules)
- **Constraint**: Trio `provider` + `type` + `product_code` must be unique.
- **Persistence**: SQLite (via `better-sqlite3`, same as aliases).
- **Schema**: 
    - `id` (INTEGER PRIMARY KEY)
    - `provider` (TEXT)
    - `type` (TEXT: 'add-product' | 'override-discount')
    - `product_code` (TEXT)
    - `quantity_value` (INTEGER, null for discount)
    - `quantity_unit` (TEXT: 'UN' | 'CX', null for discount)
    - `discount_pct` (INTEGER, null for add-product)
    - `enabled` (INTEGER: 0 | 1)

## Product Resolution & Rule Injection
- **FR-020**: Add-product lines must be merged with existing lines if the product code matches after resolving aliases.
- **Logic**:
    1. Resolve all JSON order lines to product codes.
    2. Load active `add-product` rules.
    3. Merge rules into the resolved lines map (sum quantities).
    4. Proceed to `driver.addLine` for each entry in the map.

## CLI Interaction (Rules Editor)
- **Library**: `enquirer` (already used indirectly via `prompter` context).
- **Flow**:
    1. Select Provider.
    2. Menu: List Rules | Create New.
    3. If List: Select Rule -> Edit | Disable/Enable | Delete | Back.

## Batch Execution Flow
- **Input**: `parseOrder` needs to handle `Order[] | Order`.
- **Worker**: A small abstraction that takes one `Order`, sets up its driver/repo/prompter, and runs it.
- **Summary**: Collect results/errors and print a table using `cli-table3` or simple formatted console logs.

## Interactive Mode vs Batch
- **FR-010a**: In batch mode (N > 1), disable prompts. Use a "Strict Mode" for `orchestrator` where it throws instead of asking via `prompter`.
- **Implementation**: Pass `interactive: boolean` to `runOrcamento`. If `false`, `resolveLine` and value-bump loop must fail fast.