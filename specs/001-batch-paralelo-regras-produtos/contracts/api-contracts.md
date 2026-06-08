# Contracts: Batch Paralelo e Regras de Produtos

## CLI `run` Command

- **Change**: Platforms are NO LONGER requested via `-p`.
- **Logic**: If the JSON defines `provider`, use it. If it's an array, validate ALL items have `provider`.
- **New Flag**: `--concurrency <n>` (default 3).

```bash
# Before
agent-orcamento run -p autoamerica -o pedido.json

# Now (Single)
agent-orcamento run -o pedido.json

# Now (Batch)
agent-orcamento run -o pedidos-batch.json --concurrency 2
```

## CLI `rules` Command

```bash
agent-orcamento rules [provider]
```

- If `provider` omitted, prompt user to select one.
- Commands inside interactive editor:
    - `List rules`
    - `Add rule`
    - `Toggle rule` (Enable/Disable)
    - `Delete rule`

## Service Changes (`orchestrator.ts`)

- `runOrcamento` signature update to include `rules` and `interactive` flag.
- Rule injection logic:
    - Before `driver.addLine`: load rules -> merge codes.
    - During Discount phase: check `override-discount` rules before applying portal defaults.

## Database Repository (`product-rule-repository.ts`)

```typescript
class ProductRuleRepository {
  listByProvider(provider: string): ProductRule[];
  create(rule: Omit<ProductRule, 'id' | 'createdAt'>): void;
  update(id: number, fields: Partial<ProductRule>): void;
  delete(id: number): void;
  findUnique(provider: string, type: string, code: string): ProductRule | undefined;
}
```