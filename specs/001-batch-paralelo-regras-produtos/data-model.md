# Data Model: Batch Paralelo e Regras de Produtos

## Database Schema (SQLite)

### Table: `product_rules`

```sql
CREATE TABLE IF NOT EXISTS product_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL, -- 'autoamerica' | 'roberlo'
  type           TEXT NOT NULL, -- 'add-product' | 'override-discount'
  product_code   TEXT NOT NULL,
  quantity_value INTEGER,       -- Only for 'add-product'
  quantity_unit  TEXT,          -- 'UN' | 'CX'
  discount_pct   INTEGER,       -- Only for 'override-discount'
  enabled        INTEGER NOT NULL DEFAULT 1, -- 0: false, 1: true
  created_at     TEXT NOT NULL,
  UNIQUE(provider, type, product_code)
);
```

## Internal Domain Objects

### `ProductRule` (TypeScript Interface)

```typescript
export interface ProductRule {
  id: number;
  provider: 'autoamerica' | 'roberlo';
  type: 'add-product' | 'override-discount';
  productCode: string;
  quantityValue?: number;
  quantityUnit?: 'UN' | 'CX';
  discountPct?: number;
  enabled: boolean;
  createdAt: string;
}
```

### `BatchOrder` (Unified Input)

```typescript
export interface Order {
  provider: 'autoamerica' | 'roberlo';
  client: string;
  produtos: {
    name: string; // or code
    quantity: string; // e.g., "1 CX"
  }[];
}

// Input can be Order or Order[]
```