# Agent Orçamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic CLI harness that generates quotes (orçamentos) on the Auto America and Roberlo portals from a JSON order, driving the browser via the agent-browser CLI.

**Architecture:** A deterministic orchestrator sequences a typed flow (parse → resolve products → login → add lines in units → read prices → minimum-value loop → discounts → parcelas → save). Browser interaction is encapsulated in per-platform "page drivers" that shell out to the agent-browser CLI through an injectable runner. A SQLite alias cache maps user pseudo-names to real portal products. Two human-in-the-loop stop points: product not found, and order below minimum.

**Tech Stack:** TypeScript (ESM), Node `node:sqlite`, Zod, Commander, dotenv, vitest, agent-browser CLI.

**Spec:** `do-yourself/agent-orcamento/docs/superpowers/specs/2026-06-06-agent-orcamento-design.md`

**Working directory for all paths below:** `do-yourself/agent-orcamento/`

---

## File Structure

```
src/
  cli/index.ts                          # commander entry: `run` command
  orcamento/
    order.ts            order.test.ts   # Zod schema + parseQuantity
    quantity.ts         quantity.test.ts# pure CX->units conversion
    resolver.ts         resolver.test.ts# alias lookup + live-search + persist + convert
    orchestrator.ts     orchestrator.test.ts # the deterministic flow
  platforms/
    types.ts                            # shared types: Platform, PlatformConfig, DriverResult, IPortalDriver
    autoamerica.ts      autoamerica.test.ts # config + pure business fns
    roberlo.ts          roberlo.test.ts
    agent-browser-runner.ts             # injectable child_process wrapper
    autoamerica-driver.ts               # live-mapped IPortalDriver impl
    roberlo-driver.ts
    driver.test.ts                      # driver parsing tests with stubbed runner
  db/
    schema.ts                           # CREATE TABLE
    alias-repository.ts alias-repository.test.ts # node:sqlite CRUD
  io/
    prompt.ts                           # readline interactive prompts
.env.example
```

Type ownership (defined once, reused everywhere):
- `orcamento/order.ts` → `Unit`, `ParsedQuantity`, `OrderLine`, `Order`
- `db/alias-repository.ts` → `AliasRecord`
- `platforms/types.ts` → `Platform`, `ParcelaPlan`, `PlatformConfig`, `DriverResult`, `ProductOption`, `StartQuoteOpts`, `IPortalDriver`
- `orcamento/resolver.ts` → `ResolvedLine`

---

## Phase 0 — Setup & security

### Task 0: Environment, deps, credential scrub

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `resources/auto-america.md`, `resources/roberlo.md` (remove plaintext creds)

- [ ] **Step 1: Verify Node supports `node:sqlite`**

Run: `node --version` (expect ≥ v22.5; project `@types/node` is ^25). Then:
Run: `node -e "require('node:sqlite'); console.log('ok')"`
Expected: prints `ok`. If it errors, STOP and tell the user — we will switch the DB lib to `better-sqlite3` (only `db/*.ts` change).

- [ ] **Step 2: Create `.env.example`**

```
# Portal credentials (do NOT commit real .env)
AUTOAMERICA_URL=https://representante.autoamerica.com.br:5100/portal/U_PortalLogin.apw
AUTOAMERICA_USER=000011
AUTOAMERICA_PASS=AFS35

ROBERLO_URL=http://52.67.57.130/portal/U_PortalLogin.apw
ROBERLO_USER=000002
ROBERLO_PASS=DIDIRS

# SQLite database file
ORCAMENTO_DB=./orcamento.db
```

- [ ] **Step 3: Create the real `.env`** (copy of `.env.example` with the same values). This file is git-ignored.

- [ ] **Step 4: Update `.gitignore`** — append:

```
.env
*.db
```

- [ ] **Step 5: Scrub credentials from the `.md` files**

In `resources/auto-america.md` and `resources/roberlo.md`, replace the `username:`/`password:` lines with `username: see .env (AUTOAMERICA_USER/PASS)` / `password: see .env`. Keep the `website:` and `## Constraints` sections.

- [ ] **Step 6: Commit**

```bash
git add .env.example .gitignore resources/auto-america.md resources/roberlo.md
git commit -m "chore(agent-orcamento): move portal creds to .env, scrub .md"
```

---

## Phase 1 — Pure core (order, quantity, business rules)

### Task 1: Order schema + quantity parsing

**Files:**
- Create: `src/orcamento/order.ts`
- Test: `src/orcamento/order.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/orcamento/order.test.ts
import { describe, it, expect } from 'vitest';
import { parseOrder, parseQuantity } from './order.js';

describe('parseQuantity', () => {
  it('parses units', () => {
    expect(parseQuantity('2 UN')).toEqual({ value: 2, unit: 'UN' });
  });
  it('defaults to CX when no unit given', () => {
    expect(parseQuantity('4')).toEqual({ value: 4, unit: 'CX' });
  });
  it('parses explicit CX', () => {
    expect(parseQuantity('3 CX')).toEqual({ value: 3, unit: 'CX' });
  });
  it('is case/space insensitive', () => {
    expect(parseQuantity(' 5  un ')).toEqual({ value: 5, unit: 'UN' });
  });
  it('returns undefined for empty', () => {
    expect(parseQuantity(undefined)).toBeUndefined();
    expect(parseQuantity('')).toBeUndefined();
  });
});

describe('parseOrder', () => {
  it('parses a valid order', () => {
    const order = parseOrder({
      client: '028766370',
      produtos: [
        { name: 'Produto A', quantity: '2 UN' },
        { name: 'Produto B', quantity: '4' },
        { name: 'Produto C' },
      ],
    });
    expect(order.client).toBe('028766370');
    expect(order.produtos[0]).toEqual({ name: 'Produto A', quantity: { value: 2, unit: 'UN' } });
    expect(order.produtos[1]).toEqual({ name: 'Produto B', quantity: { value: 4, unit: 'CX' } });
    expect(order.produtos[2]).toEqual({ name: 'Produto C', quantity: undefined });
  });
  it('throws on missing client', () => {
    expect(() => parseOrder({ produtos: [] })).toThrow();
  });
  it('throws on invalid quantity', () => {
    expect(() => parseOrder({ client: 'x', produtos: [{ name: 'A', quantity: 'abc' }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/orcamento/order.test.ts`
Expected: FAIL — cannot find module `./order.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orcamento/order.ts
import { z } from 'zod';

export type Unit = 'UN' | 'CX';
export interface ParsedQuantity { value: number; unit: Unit; }
export interface OrderLine { name: string; quantity?: ParsedQuantity; }
export interface Order { client: string; produtos: OrderLine[]; }

const QTY_RE = /^(\d+(?:[.,]\d+)?)\s*(UN|CX)?$/i;

export function parseQuantity(raw: string | undefined): ParsedQuantity | undefined {
  if (raw == null) return undefined;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '') return undefined;
  const m = QTY_RE.exec(s);
  if (!m) throw new Error(`Quantidade inválida: "${raw}"`);
  const value = Number(m[1].replace(',', '.'));
  const unit = (m[2]?.toUpperCase() as Unit) ?? 'CX';
  return { value, unit };
}

const rawOrderSchema = z.object({
  client: z.string().min(1),
  produtos: z.array(z.object({
    name: z.string().min(1),
    quantity: z.string().optional(),
  })),
});

export function parseOrder(input: unknown): Order {
  const raw = rawOrderSchema.parse(input);
  return {
    client: raw.client,
    produtos: raw.produtos.map((p) => ({
      name: p.name,
      quantity: parseQuantity(p.quantity),
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/orcamento/order.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/orcamento/order.ts src/orcamento/order.test.ts
git commit -m "feat(agent-orcamento): order schema and quantity parsing"
```

### Task 2: Quantity → site units conversion

**Files:**
- Create: `src/orcamento/quantity.ts`
- Test: `src/orcamento/quantity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/orcamento/quantity.test.ts
import { describe, it, expect } from 'vitest';
import { toSiteUnits } from './quantity.js';

describe('toSiteUnits', () => {
  const upb = 6; // units per box
  it('CX multiplies by units_per_box', () => {
    expect(toSiteUnits({ value: 4, unit: 'CX' }, upb)).toBe(24);
  });
  it('UN passes through unchanged', () => {
    expect(toSiteUnits({ value: 2, unit: 'UN' }, upb)).toBe(2);
  });
  it('not informed => one box', () => {
    expect(toSiteUnits(undefined, upb)).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/orcamento/quantity.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orcamento/quantity.ts
import type { ParsedQuantity } from './order.js';

/** Converts an order quantity to the number of UNITS the site expects.
 *  CX -> value * unitsPerBox; UN -> value; not informed -> one box. */
export function toSiteUnits(qty: ParsedQuantity | undefined, unitsPerBox: number): number {
  if (qty == null) return unitsPerBox;
  return qty.unit === 'UN' ? qty.value : qty.value * unitsPerBox;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/orcamento/quantity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orcamento/quantity.ts src/orcamento/quantity.test.ts
git commit -m "feat(agent-orcamento): box->unit quantity conversion"
```

### Task 3: Platform shared types

**Files:**
- Create: `src/platforms/types.ts`

- [ ] **Step 1: Write the types** (no test — type-only module, verified by `pnpm lint`)

```ts
// src/platforms/types.ts
export type Platform = 'autoamerica' | 'roberlo';

export interface ParcelaPlan { label: string; } // e.g. "30/60", "30/60/90"

export interface PlatformConfig {
  id: Platform;
  url: string;
  tipoOrcamento: string;
  tabelaPrecos?: string;
  transportadora: string;
  frete: 'CIF' | 'FOB';
  minOrderValue: number;
  /** Per-line discount % from box count (AA). Returns 0 when none applies. */
  computeLineDiscount(boxes: number): number;
  /** Installment plan from the order total. */
  computeParcelas(total: number): ParcelaPlan;
}

export interface ProductOption { code: string; name: string; }

export interface StartQuoteOpts {
  client: string;
  tipo: string;
  tabelaPrecos?: string;
  transportadora: string;
  frete: string;
}

export interface DriverResult<T = unknown> {
  status: 'success' | 'warning' | 'error';
  summary: string;
  data?: T;
  next_actions?: string[];
}

export interface IPortalDriver {
  login(): Promise<DriverResult>;
  startQuote(opts: StartQuoteOpts): Promise<DriverResult>;
  searchProducts(terms: string): Promise<DriverResult<ProductOption[]>>;
  addLine(productCode: string, units: number): Promise<DriverResult>;
  readLinePrice(productCode: string): Promise<DriverResult<{ unit: number; total: number }>>;
  applyDiscount(productCode: string, pct: number): Promise<DriverResult>;
  readOrderTotal(): Promise<DriverResult<number>>;
  setParcelas(plan: ParcelaPlan): Promise<DriverResult>;
  save(): Promise<DriverResult>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/platforms/types.ts
git commit -m "feat(agent-orcamento): shared platform/driver types"
```

### Task 4: Auto America config + business rules

**Files:**
- Create: `src/platforms/autoamerica.ts`
- Test: `src/platforms/autoamerica.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/platforms/autoamerica.test.ts
import { describe, it, expect } from 'vitest';
import { autoamerica } from './autoamerica.js';

describe('autoamerica config', () => {
  it('has the right constraints', () => {
    expect(autoamerica.minOrderValue).toBe(2500);
    expect(autoamerica.tabelaPrecos).toBe('099 - POLIMENTO C5_12% SP-RS-MG-RJ');
    expect(autoamerica.frete).toBe('CIF');
    expect(autoamerica.tipoOrcamento).toBe('Em elaboração');
  });
  it('gives 15% discount for more than 10 boxes', () => {
    expect(autoamerica.computeLineDiscount(11)).toBe(15);
    expect(autoamerica.computeLineDiscount(10)).toBe(0);
    expect(autoamerica.computeLineDiscount(1)).toBe(0);
  });
  it('parcelas: below 5k => 30/60, below 10k => 30/60/90', () => {
    expect(autoamerica.computeParcelas(4999).label).toBe('30/60');
    expect(autoamerica.computeParcelas(5000).label).toBe('30/60/90');
    expect(autoamerica.computeParcelas(9999).label).toBe('30/60/90');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/platforms/autoamerica.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platforms/autoamerica.ts
import type { PlatformConfig } from './types.js';

export const autoamerica: PlatformConfig = {
  id: 'autoamerica',
  url: process.env.AUTOAMERICA_URL ?? '',
  tipoOrcamento: 'Em elaboração',
  tabelaPrecos: '099 - POLIMENTO C5_12% SP-RS-MG-RJ',
  transportadora: 'EXPRESSO SAO MIGUEL LTDA',
  frete: 'CIF',
  minOrderValue: 2500,
  computeLineDiscount(boxes: number): number {
    return boxes > 10 ? 15 : 0;
  },
  computeParcelas(total: number) {
    return { label: total < 5000 ? '30/60' : '30/60/90' };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/platforms/autoamerica.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/autoamerica.ts src/platforms/autoamerica.test.ts
git commit -m "feat(agent-orcamento): Auto America config and business rules"
```

### Task 5: Roberlo config + business rules

**Files:**
- Create: `src/platforms/roberlo.ts`
- Test: `src/platforms/roberlo.test.ts`

Note: Roberlo's discount is read live from the portal (`Desconto 02`, fallback `Desconto 03`), so `computeLineDiscount` always returns 0 here — the driver decides the actual percent (see Task 12). This keeps the `PlatformConfig` shape uniform.

- [ ] **Step 1: Write the failing test**

```ts
// src/platforms/roberlo.test.ts
import { describe, it, expect } from 'vitest';
import { roberlo } from './roberlo.js';

describe('roberlo config', () => {
  it('has the right constraints', () => {
    expect(roberlo.minOrderValue).toBe(5000);
    expect(roberlo.frete).toBe('CIF');
    expect(roberlo.tipoOrcamento).toBe('Previsto');
    expect(roberlo.transportadora).toContain('TRANS');
  });
  it('discount is portal-driven (config returns 0)', () => {
    expect(roberlo.computeLineDiscount(99)).toBe(0);
  });
  it('parcelas: below 10k => 30/60/90', () => {
    expect(roberlo.computeParcelas(9999).label).toBe('30/60/90');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/platforms/roberlo.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platforms/roberlo.ts
import type { PlatformConfig } from './types.js';

export const roberlo: PlatformConfig = {
  id: 'roberlo',
  url: process.env.ROBERLO_URL ?? '',
  tipoOrcamento: 'Previsto',
  transportadora: 'TRANS - FACE TRANSPORTES LTDA - 61683652000243',
  frete: 'CIF',
  minOrderValue: 5000,
  computeLineDiscount(): number {
    return 0; // discount read from portal by the driver (Desconto 02 -> 03)
  },
  computeParcelas() {
    return { label: '30/60/90' };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/platforms/roberlo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/roberlo.ts src/platforms/roberlo.test.ts
git commit -m "feat(agent-orcamento): Roberlo config and business rules"
```

---

## Phase 2 — SQLite alias cache

### Task 6: DB schema

**Files:**
- Create: `src/db/schema.ts`

- [ ] **Step 1: Write the schema module**

```ts
// src/db/schema.ts
export const CREATE_ALIASES = `
CREATE TABLE IF NOT EXISTS aliases (
  platform      TEXT NOT NULL,
  alias_norm    TEXT NOT NULL,
  alias_raw     TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  units_per_box INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (platform, alias_norm)
);
`;

/** Normalizes an alias: lowercase, strip accents, collapse whitespace. */
export function normalizeAlias(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(agent-orcamento): db schema and alias normalization"
```

### Task 7: Alias repository

**Files:**
- Create: `src/db/alias-repository.ts`
- Test: `src/db/alias-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/alias-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AliasRepository } from './alias-repository.js';

let dbPath: string;
let repo: AliasRepository;

beforeEach(() => {
  dbPath = join(tmpdir(), `orc-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  repo = new AliasRepository(dbPath);
});
afterEach(() => {
  repo.close();
  rmSync(dbPath, { force: true });
});

describe('AliasRepository', () => {
  it('returns undefined for an unknown alias', () => {
    expect(repo.find('autoamerica', 'Produto A')).toBeUndefined();
  });

  it('saves and finds an alias (normalized lookup)', () => {
    repo.save({
      platform: 'autoamerica',
      aliasRaw: 'Produto A',
      productCode: '303535001',
      productName: 'BRILHO RAP S/SIL MOTHERS 473ML',
      unitsPerBox: 6,
    });
    const found = repo.find('autoamerica', '  produto   a ');
    expect(found?.productCode).toBe('303535001');
    expect(found?.unitsPerBox).toBe(6);
  });

  it('scopes aliases by platform', () => {
    repo.save({ platform: 'autoamerica', aliasRaw: 'X', productCode: '1', productName: 'n', unitsPerBox: 2 });
    expect(repo.find('roberlo', 'X')).toBeUndefined();
  });

  it('upserts on the same platform+alias', () => {
    repo.save({ platform: 'roberlo', aliasRaw: 'Y', productCode: '1', productName: 'a', unitsPerBox: 2 });
    repo.save({ platform: 'roberlo', aliasRaw: 'Y', productCode: '2', productName: 'b', unitsPerBox: 4 });
    expect(repo.find('roberlo', 'Y')?.productCode).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/alias-repository.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/db/alias-repository.ts
import { DatabaseSync } from 'node:sqlite';
import { CREATE_ALIASES, normalizeAlias } from './schema.js';
import type { Platform } from '../platforms/types.js';

export interface AliasRecord {
  platform: Platform;
  aliasNorm: string;
  aliasRaw: string;
  productCode: string;
  productName: string;
  unitsPerBox: number;
  createdAt: string;
}

export interface SaveAliasInput {
  platform: Platform;
  aliasRaw: string;
  productCode: string;
  productName: string;
  unitsPerBox: number;
}

export class AliasRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_ALIASES);
  }

  find(platform: Platform, aliasRaw: string): AliasRecord | undefined {
    const stmt = this.db.prepare(
      'SELECT platform, alias_norm, alias_raw, product_code, product_name, units_per_box, created_at FROM aliases WHERE platform = ? AND alias_norm = ?',
    );
    const row = stmt.get(platform, normalizeAlias(aliasRaw)) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      platform: row.platform as Platform,
      aliasNorm: row.alias_norm as string,
      aliasRaw: row.alias_raw as string,
      productCode: row.product_code as string,
      productName: row.product_name as string,
      unitsPerBox: Number(row.units_per_box),
      createdAt: row.created_at as string,
    };
  }

  save(input: SaveAliasInput): void {
    const stmt = this.db.prepare(
      `INSERT INTO aliases (platform, alias_norm, alias_raw, product_code, product_name, units_per_box, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, alias_norm) DO UPDATE SET
         alias_raw = excluded.alias_raw,
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         units_per_box = excluded.units_per_box`,
    );
    stmt.run(
      input.platform,
      normalizeAlias(input.aliasRaw),
      input.aliasRaw,
      input.productCode,
      input.productName,
      input.unitsPerBox,
      new Date().toISOString(),
    );
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/db/alias-repository.test.ts`
Expected: PASS. (If `node:sqlite` import fails under vitest, run with `--pool=forks`; if still failing, STOP and ask the user about switching to `better-sqlite3`.)

- [ ] **Step 5: Commit**

```bash
git add src/db/alias-repository.ts src/db/alias-repository.test.ts
git commit -m "feat(agent-orcamento): SQLite alias repository"
```

---

## Phase 3 — Interactive prompts

### Task 8: Prompt module

**Files:**
- Create: `src/io/prompt.ts`
- Test: `src/io/prompt.test.ts`

The prompt module exposes an interface so the orchestrator/resolver can be tested with a stub. The real implementation uses `node:readline/promises`.

- [ ] **Step 1: Write the failing test** (tests the pure selection-formatting helper)

```ts
// src/io/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { formatOptions } from './prompt.js';

describe('formatOptions', () => {
  it('numbers options from 1', () => {
    const text = formatOptions([
      { code: '1', name: 'Alpha' },
      { code: '2', name: 'Beta' },
    ]);
    expect(text).toContain('1) 1 - Alpha');
    expect(text).toContain('2) 2 - Beta');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/io/prompt.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/io/prompt.ts
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ProductOption } from '../platforms/types.js';

export interface Prompter {
  /** Free-text question; returns the trimmed answer. */
  ask(question: string): Promise<string>;
  /** Pick one option from a list, or return null to re-search. */
  choose(question: string, options: ProductOption[]): Promise<ProductOption | null>;
  /** Ask for a positive integer (e.g. units per box, or which line to bump). */
  askInt(question: string): Promise<number>;
}

export function formatOptions(options: ProductOption[]): string {
  return options.map((o, i) => `${i + 1}) ${o.code} - ${o.name}`).join('\n');
}

export class ConsolePrompter implements Prompter {
  async ask(question: string): Promise<string> {
    const rl = readline.createInterface({ input, output });
    try { return (await rl.question(`${question} `)).trim(); }
    finally { rl.close(); }
  }

  async askInt(question: string): Promise<number> {
    for (;;) {
      const raw = await this.ask(question);
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) return n;
      output.write('Digite um número inteiro positivo.\n');
    }
  }

  async choose(question: string, options: ProductOption[]): Promise<ProductOption | null> {
    output.write(`${question}\n${formatOptions(options)}\n0) Nenhum / buscar de novo\n`);
    for (;;) {
      const raw = await this.ask('Escolha o número:');
      const n = Number(raw);
      if (n === 0) return null;
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
      output.write('Opção inválida.\n');
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/io/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/prompt.ts src/io/prompt.test.ts
git commit -m "feat(agent-orcamento): interactive prompt module"
```

---

## Phase 4 — agent-browser runner + driver scaffolding

### Task 9: agent-browser runner

**Files:**
- Create: `src/platforms/agent-browser-runner.ts`
- Test: `src/platforms/agent-browser-runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/platforms/agent-browser-runner.test.ts
import { describe, it, expect } from 'vitest';
import { makeRunner } from './agent-browser-runner.js';

describe('makeRunner', () => {
  it('runs a command and captures stdout', async () => {
    // Inject a fake spawn-like exec that echoes the args.
    const runner = makeRunner(async (args) => ({ stdout: args.join(' '), stderr: '', code: 0 }));
    const res = await runner(['snapshot', '-i']);
    expect(res.stdout).toBe('snapshot -i');
    expect(res.code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/platforms/agent-browser-runner.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platforms/agent-browser-runner.ts
import { execFile } from 'node:child_process';

export interface RunResult { stdout: string; stderr: string; code: number; }
export type AgentBrowserRunner = (args: string[]) => Promise<RunResult>;
export type ExecFn = (args: string[]) => Promise<RunResult>;

/** Wraps an exec function so a stub can be injected in tests. */
export function makeRunner(exec: ExecFn): AgentBrowserRunner {
  return (args) => exec(args);
}

/** Real runner: shells out to the installed `agent-browser` CLI. */
export const realRunner: AgentBrowserRunner = makeRunner(
  (args) => new Promise((resolve) => {
    execFile('agent-browser', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? (err.code as number ?? 1) : 0 });
    });
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/platforms/agent-browser-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/agent-browser-runner.ts src/platforms/agent-browser-runner.test.ts
git commit -m "feat(agent-orcamento): injectable agent-browser runner"
```

### Task 10: Driver snapshot-parsing helpers (testable, runner-stubbed)

**Files:**
- Create: `src/platforms/driver-helpers.ts`
- Test: `src/platforms/driver.test.ts`

These pure helpers parse agent-browser `snapshot --json` output and `get text` values into the typed data the driver returns. They are unit-testable without a browser.

- [ ] **Step 1: Write the failing test**

```ts
// src/platforms/driver.test.ts
import { describe, it, expect } from 'vitest';
import { parseDropdownOptions, parseBRL } from './driver-helpers.js';

describe('parseBRL', () => {
  it('parses Brazilian currency', () => {
    expect(parseBRL('R$ 2.500,00')).toBe(2500);
    expect(parseBRL('1.234,56')).toBeCloseTo(1234.56);
    expect(parseBRL('R$ 0,00')).toBe(0);
  });
});

describe('parseDropdownOptions', () => {
  it('extracts code + name from "CODE - NAME" option labels', () => {
    const opts = parseDropdownOptions([
      '303535001 - BRILHO RAP S/SIL MOTHERS 473ML',
      '303535004 - CAL.GOLD SYNTHETIC WAX',
    ]);
    expect(opts).toEqual([
      { code: '303535001', name: 'BRILHO RAP S/SIL MOTHERS 473ML' },
      { code: '303535004', name: 'CAL.GOLD SYNTHETIC WAX' },
    ]);
  });
  it('keeps the raw label as name when there is no " - " separator', () => {
    expect(parseDropdownOptions(['MISC ITEM'])).toEqual([{ code: '', name: 'MISC ITEM' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/platforms/driver.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/platforms/driver-helpers.ts
import type { ProductOption } from './types.js';

/** "R$ 2.500,00" -> 2500. Strips currency, dots (thousands), comma -> dot. */
export function parseBRL(text: string): number {
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  if (Number.isNaN(n)) throw new Error(`Valor monetário inválido: "${text}"`);
  return n;
}

/** Splits "CODE - NAME" dropdown labels into { code, name }. */
export function parseDropdownOptions(labels: string[]): ProductOption[] {
  return labels.map((raw) => {
    const idx = raw.indexOf(' - ');
    if (idx === -1) return { code: '', name: raw.trim() };
    return { code: raw.slice(0, idx).trim(), name: raw.slice(idx + 3).trim() };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/platforms/driver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/driver-helpers.ts src/platforms/driver.test.ts
git commit -m "feat(agent-orcamento): driver snapshot/currency parsing helpers"
```

---

## Phase 5 — Live portal driver mapping (interactive sessions)

> ⚠️ **These two tasks require a live browser session with agent-browser.** Exact selectors are unknown until mapped against the live portal. The driver methods are written using agent-browser **semantic locators** (`find label/text/role`) keyed off the Portuguese field labels in the constraints docs, plus `snapshot --json` parsing. During the session, run each step against the live page and adjust locators to match.
>
> **STOP-AND-ASK RULE (explicit user preference):** If a locator does not resolve reliably after re-snapshotting once, STOP and ask the user for help. Do **not** loop trying variations. Save the failing snapshot to `tmp/` and show it.

### Task 11: Auto America driver (live mapping)

**Files:**
- Create: `src/platforms/autoamerica-driver.ts`

**Reference:** product field is a **select2** dropdown (`select2-CK_PRODUTO01`, rows `PRODUTO01..NN`). Login at `AUTOAMERICA_URL` with `AUTOAMERICA_USER`/`AUTOAMERICA_PASS`.

- [ ] **Step 1: Start a live session and log in manually to map the flow**

```bash
agent-browser open "$AUTOAMERICA_URL"
agent-browser snapshot -i        # identify user/password/login refs
```
Fill and submit using the refs you see; `wait --load networkidle`; snapshot again. Record the working locators in a scratch note. If anything is ambiguous, STOP and ask the user.

- [ ] **Step 2: Map each driver action** by navigating to the quote screen and snapshotting before/after each interaction:
  - new quote / set `Tipo de Orçamento` = "Em elaboração", client field, `Tabela de preços` = 099, `Transportadora`, `Tipo de frete` = CIF
  - product dropdown (select2): how to open, type to filter, read result `<li>` labels, select one
  - quantity field per line (units), line total field, discount field
  - order total field, parcelas field, save button

Save useful snapshots to `tmp/aa-*.txt` for reference. STOP and ask the user on any blocker.

- [ ] **Step 3: Write the driver** implementing `IPortalDriver` (Task 3) using the mapped locators. Skeleton (fill in the locators confirmed in Steps 1–2):

```ts
// src/platforms/autoamerica-driver.ts
import type {
  IPortalDriver, DriverResult, ProductOption, StartQuoteOpts, ParcelaPlan,
} from './types.js';
import type { AgentBrowserRunner } from './agent-browser-runner.js';
import { parseDropdownOptions, parseBRL } from './driver-helpers.js';

export class AutoAmericaDriver implements IPortalDriver {
  constructor(
    private readonly run: AgentBrowserRunner,
    private readonly creds: { url: string; user: string; pass: string },
  ) {}

  private ok<T>(summary: string, data?: T): DriverResult<T> {
    return { status: 'success', summary, data };
  }
  private fail(summary: string, next?: string[]): DriverResult {
    return { status: 'error', summary, next_actions: next };
  }

  async login(): Promise<DriverResult> {
    await this.run(['open', this.creds.url]);
    // Locators confirmed during live mapping (Step 1):
    await this.run(['find', 'label', 'Usuário', 'fill', this.creds.user]);
    await this.run(['find', 'label', 'Senha', 'fill', this.creds.pass]);
    await this.run(['find', 'role', 'button', 'click', '--name', 'Entrar']);
    const r = await this.run(['wait', '--load', 'networkidle']);
    return r.code === 0 ? this.ok('login ok') : this.fail('login falhou', ['re-snapshot e pedir ajuda']);
  }

  async startQuote(opts: StartQuoteOpts): Promise<DriverResult> {
    // ... mapped steps: open new quote, set tipo, client, tabela, transportadora, frete
    return this.ok('orçamento iniciado');
  }

  async searchProducts(terms: string): Promise<DriverResult<ProductOption[]>> {
    // open select2, type terms, read the visible <li> option labels via snapshot --json
    await this.run(['find', 'text', 'Produto', 'click']);          // open dropdown (confirm locator)
    await this.run(['type', '.select2-search__field', terms]);     // confirm selector
    await this.run(['wait', '--load', 'networkidle']);
    const r = await this.run(['get', 'text', '.select2-results']); // confirm selector
    const labels = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    return this.ok('produtos encontrados', parseDropdownOptions(labels));
  }

  async addLine(productCode: string, units: number): Promise<DriverResult> {
    // select the option whose label starts with productCode, then fill the qty field with units
    return this.ok(`linha ${productCode} (${units} un) adicionada`);
  }

  async readLinePrice(productCode: string): Promise<DriverResult<{ unit: number; total: number }>> {
    // read the line's unit/total cells, parse with parseBRL
    return this.ok('preço lido', { unit: 0, total: 0 });
  }

  async applyDiscount(productCode: string, pct: number): Promise<DriverResult> {
    return this.ok(`desconto ${pct}% aplicado em ${productCode}`);
  }

  async readOrderTotal(): Promise<DriverResult<number>> {
    const r = await this.run(['get', 'text', '#total']); // confirm selector
    return this.ok('total lido', parseBRL(r.stdout));
  }

  async setParcelas(plan: ParcelaPlan): Promise<DriverResult> {
    return this.ok(`parcelas ${plan.label}`);
  }

  async save(): Promise<DriverResult> {
    await this.run(['find', 'role', 'button', 'click', '--name', 'Salvar']);
    return this.ok('orçamento salvo');
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm lint`
Expected: no errors. (Behaviour is validated in the end-to-end run, Task 15.)

- [ ] **Step 5: Commit**

```bash
git add src/platforms/autoamerica-driver.ts
git commit -m "feat(agent-orcamento): Auto America portal driver"
```

### Task 12: Roberlo driver (live mapping)

**Files:**
- Create: `src/platforms/roberlo-driver.ts`

**Reference:** product field is a **bootstrap-select** dropdown (span.text inside non-`dropdown-header` `<li>`). Discount: read the max of `Desconto 02`; if 0, use `Desconto 03` if present, and apply that percent via `applyDiscount`.

- [ ] **Step 1: Live login + map** the same actions as Task 11 against `ROBERLO_URL` with `ROBERLO_USER`/`ROBERLO_PASS`. Note bootstrap-select differences (open button, `.dropdown-menu .text` option labels, search box). STOP and ask the user on any blocker; save snapshots to `tmp/roberlo-*.txt`.

- [ ] **Step 2: Map the discount fields** `Desconto 02` / `Desconto 03` per line — how to read the max allowed value and how to set the field.

- [ ] **Step 3: Write the driver** implementing `IPortalDriver`, mirroring the `AutoAmericaDriver` structure (Task 11 Step 3) but with bootstrap-select locators. Its `applyDiscount` is called by the orchestrator with the percent the orchestrator computed by reading `Desconto 02`/`03` — so add a helper to read those:

```ts
// add to src/platforms/roberlo-driver.ts (RoberloDriver class)
/** Reads the max allowed discount for a line: Desconto 02, fallback Desconto 03. */
async readMaxDiscount(productCode: string): Promise<DriverResult<number>> {
  // read the Desconto 02 cell for this line; if 0, read Desconto 03
  // parse numeric percent; return it
  return this.ok('desconto máximo lido', 0);
}
```

Extend the `IPortalDriver` usage: the orchestrator will call `readMaxDiscount` only for Roberlo (narrowed via the platform id), so add `readMaxDiscount` as an **optional** method on the `RoberloDriver` only — do NOT add it to `IPortalDriver` (keeps Auto America clean). The orchestrator checks `if ('readMaxDiscount' in driver)`.

- [ ] **Step 4: Verify it compiles**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/roberlo-driver.ts
git commit -m "feat(agent-orcamento): Roberlo portal driver"
```

---

## Phase 6 — Resolver

### Task 13: Product resolver

**Files:**
- Create: `src/orcamento/resolver.ts`
- Test: `src/orcamento/resolver.test.ts`

The resolver turns an `OrderLine` into a `ResolvedLine`: cache hit, or live search + prompt + persist. It uses stubs for repo/driver/prompter in tests.

- [ ] **Step 1: Write the failing test**

```ts
// src/orcamento/resolver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveLine } from './resolver.js';
import type { Prompter } from '../io/prompt.js';
import type { IPortalDriver, ProductOption } from '../platforms/types.js';

function stubDriver(options: ProductOption[]): IPortalDriver {
  return {
    login: vi.fn(), startQuote: vi.fn(), addLine: vi.fn(), readLinePrice: vi.fn(),
    applyDiscount: vi.fn(), readOrderTotal: vi.fn(), setParcelas: vi.fn(), save: vi.fn(),
    searchProducts: vi.fn(async () => ({ status: 'success', summary: '', data: options })),
  } as unknown as IPortalDriver;
}

describe('resolveLine', () => {
  it('uses the cache on a hit and converts CX to units', async () => {
    const repo = {
      find: vi.fn(() => ({ productCode: '303535001', productName: 'BRILHO', unitsPerBox: 6 })),
      save: vi.fn(),
    };
    const line = { name: 'Produto A', quantity: { value: 4, unit: 'CX' as const } };
    const resolved = await resolveLine(line, {
      platform: 'autoamerica', repo: repo as any, driver: stubDriver([]), prompter: {} as Prompter,
    });
    expect(resolved.productCode).toBe('303535001');
    expect(resolved.siteUnits).toBe(24);   // 4 * 6
    expect(resolved.boxes).toBe(4);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('on a miss, searches live, asks the user, persists, and converts', async () => {
    const repo = { find: vi.fn(() => undefined), save: vi.fn() };
    const options = [{ code: '303535001', name: 'BRILHO RAP' }];
    const prompter: Prompter = {
      ask: vi.fn(async () => 'brilho'),
      choose: vi.fn(async () => options[0]),
      askInt: vi.fn(async () => 6),
    };
    const line = { name: 'Produto A', quantity: { value: 2, unit: 'UN' as const } };
    const resolved = await resolveLine(line, {
      platform: 'autoamerica', repo: repo as any, driver: stubDriver(options), prompter,
    });
    expect(prompter.choose).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'autoamerica', aliasRaw: 'Produto A', productCode: '303535001', unitsPerBox: 6,
    }));
    expect(resolved.siteUnits).toBe(2);     // UN passes through
    expect(resolved.boxes).toBe(1);         // 2 units / 6 per box -> ceil = 1
  });

  it('re-searches when the user picks "none" then chooses', async () => {
    const repo = { find: vi.fn(() => undefined), save: vi.fn() };
    const opts = [{ code: '1', name: 'A' }];
    const choose = vi.fn()
      .mockResolvedValueOnce(null)         // first: none -> re-search
      .mockResolvedValueOnce(opts[0]);     // second: pick
    const prompter: Prompter = { ask: vi.fn(async () => 'a'), choose, askInt: vi.fn(async () => 3) };
    const resolved = await resolveLine(
      { name: 'Z', quantity: undefined },
      { platform: 'roberlo', repo: repo as any, driver: stubDriver(opts), prompter },
    );
    expect(choose).toHaveBeenCalledTimes(2);
    expect(resolved.siteUnits).toBe(3);     // not informed -> one box (unitsPerBox=3)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/orcamento/resolver.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orcamento/resolver.ts
import type { OrderLine } from './order.js';
import { toSiteUnits } from './quantity.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { Prompter } from '../io/prompt.js';
import type { IPortalDriver, Platform } from '../platforms/types.js';

export interface ResolvedLine {
  name: string;
  productCode: string;
  productName: string;
  unitsPerBox: number;
  requested?: OrderLine['quantity'];
  siteUnits: number;
  boxes: number;
}

export interface ResolveDeps {
  platform: Platform;
  repo: AliasRepository;
  driver: IPortalDriver;
  prompter: Prompter;
}

export async function resolveLine(line: OrderLine, deps: ResolveDeps): Promise<ResolvedLine> {
  const { platform, repo, driver, prompter } = deps;

  const cached = repo.find(platform, line.name);
  if (cached) {
    return build(line, cached.productCode, cached.productName, cached.unitsPerBox);
  }

  // Miss -> interactive resolution (live search on the portal).
  let terms = line.name;
  for (;;) {
    const res = await driver.searchProducts(terms);
    const options = res.data ?? [];
    const picked = await prompter.choose(
      `Produto não encontrado: "${line.name}". Resultados para "${terms}":`,
      options,
    );
    if (picked) {
      const unitsPerBox = await prompter.askInt(`Quantas unidades = 1 caixa de "${picked.name}"?`);
      repo.save({
        platform, aliasRaw: line.name,
        productCode: picked.code, productName: picked.name, unitsPerBox,
      });
      return build(line, picked.code, picked.name, unitsPerBox);
    }
    terms = await prompter.ask('Digite novos termos de busca:');
  }
}

function build(line: OrderLine, code: string, name: string, unitsPerBox: number): ResolvedLine {
  const siteUnits = toSiteUnits(line.quantity, unitsPerBox);
  return {
    name: line.name,
    productCode: code,
    productName: name,
    unitsPerBox,
    requested: line.quantity,
    siteUnits,
    boxes: Math.ceil(siteUnits / unitsPerBox),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/orcamento/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orcamento/resolver.ts src/orcamento/resolver.test.ts
git commit -m "feat(agent-orcamento): product resolver with live-search fallback"
```

---

## Phase 7 — Orchestrator

### Task 14: Orchestrator (minimum-value loop + discounts + parcelas)

**Files:**
- Create: `src/orcamento/orchestrator.ts`
- Test: `src/orcamento/orchestrator.test.ts`

The orchestrator sequences the whole flow against the `IPortalDriver` and `Prompter`. The minimum-value loop and discount application are the testable core; we verify them with a fully stubbed driver that simulates portal prices.

- [ ] **Step 1: Write the failing test**

```ts
// src/orcamento/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOrcamento } from './orchestrator.js';
import { autoamerica } from '../platforms/autoamerica.js';
import type { ResolvedLine } from './resolver.js';
import type { Prompter } from '../io/prompt.js';

/** Stub driver: price = boxes * pricePerBox; total = sum of line totals. */
function priceModelDriver(pricePerBox: Record<string, number>) {
  const units: Record<string, number> = {};
  return {
    login: vi.fn(async () => ({ status: 'success', summary: '' })),
    startQuote: vi.fn(async () => ({ status: 'success', summary: '' })),
    searchProducts: vi.fn(),
    addLine: vi.fn(async (code: string, u: number) => { units[code] = u; return { status: 'success', summary: '' }; }),
    readLinePrice: vi.fn(async (code: string) => ({ status: 'success', summary: '', data: { unit: 0, total: 0 } })),
    applyDiscount: vi.fn(async () => ({ status: 'success', summary: '' })),
    readOrderTotal: vi.fn(async () => {
      const total = Object.entries(units).reduce(
        (sum, [code, u]) => sum + (u / 6) * pricePerBox[code], 0); // 6 units/box in this test
      return { status: 'success', summary: '', data: total };
    }),
    setParcelas: vi.fn(async () => ({ status: 'success', summary: '' })),
    save: vi.fn(async () => ({ status: 'success', summary: '' })),
    _units: units,
  };
}

const line = (code: string, boxes: number): ResolvedLine => ({
  name: code, productCode: code, productName: code, unitsPerBox: 6,
  requested: { value: boxes, unit: 'CX' }, siteUnits: boxes * 6, boxes,
});

describe('runOrcamento', () => {
  it('stops at minimum when total already meets it; sets parcelas; saves', async () => {
    const driver = priceModelDriver({ A: 3000 }); // 1 box = 3000 >= 2500
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn() };
    const result = await runOrcamento({
      platform: autoamerica, client: 'c', lines: [line('A', 1)],
      driver: driver as any, prompter,
    });
    expect(driver.save).toHaveBeenCalled();
    expect(driver.setParcelas).toHaveBeenCalledWith({ label: '30/60' }); // 3000 < 5000
    expect(result.total).toBe(3000);
  });

  it('asks the user which line to bump when below minimum, one box per step', async () => {
    const driver = priceModelDriver({ A: 1000 }); // each box = 1000; need >= 2500 -> 3 boxes
    const askInt = vi.fn(async () => 1); // user picks line #1 to bump each time
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt };
    const result = await runOrcamento({
      platform: autoamerica, client: 'c', lines: [line('A', 1)],
      driver: driver as any, prompter,
    });
    expect(driver._units.A).toBe(18); // 3 boxes * 6 units
    expect(result.total).toBe(3000);
  });

  it('applies the 15% line discount when a line exceeds 10 boxes (Auto America)', async () => {
    const driver = priceModelDriver({ A: 300 }); // 11 boxes -> 3300 >= 2500
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn() };
    await runOrcamento({
      platform: autoamerica, client: 'c', lines: [line('A', 11)],
      driver: driver as any, prompter,
    });
    expect(driver.applyDiscount).toHaveBeenCalledWith('A', 15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/orcamento/orchestrator.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/orcamento/orchestrator.ts
import type { PlatformConfig, IPortalDriver } from '../platforms/types.js';
import type { Prompter } from '../io/prompt.js';
import type { ResolvedLine } from './resolver.js';

export interface RunOrcamentoInput {
  platform: PlatformConfig;
  client: string;
  lines: ResolvedLine[];
  driver: IPortalDriver;
  prompter: Prompter;
}

export interface RunOrcamentoResult { total: number; parcelas: string; }

const MAX_BUMP_ITERATIONS = 1000;

export async function runOrcamento(input: RunOrcamentoInput): Promise<RunOrcamentoResult> {
  const { platform, client, lines, driver, prompter } = input;

  await driver.login();
  await driver.startQuote({
    client,
    tipo: platform.tipoOrcamento,
    tabelaPrecos: platform.tabelaPrecos,
    transportadora: platform.transportadora,
    frete: platform.frete,
  });

  // Add all lines in units.
  const boxes = new Map<string, number>();
  for (const l of lines) {
    await driver.addLine(l.productCode, l.siteUnits);
    boxes.set(l.productCode, l.boxes);
  }

  // Minimum-value loop: ask the user which line to bump (1 box per step).
  let total = (await driver.readOrderTotal()).data ?? 0;
  let iterations = 0;
  while (total < platform.minOrderValue) {
    if (++iterations > MAX_BUMP_ITERATIONS) {
      throw new Error('Loop de valor-mínimo excedeu o limite de iterações.');
    }
    const labels = lines.map((l) => ({ code: l.productCode, name: `${l.productName} (${boxes.get(l.productCode)} cx)` }));
    const idx = await prompter.askInt(
      `Total ${total.toFixed(2)} < mínimo ${platform.minOrderValue}. Qual produto aumentar (1 caixa)?\n` +
      labels.map((o, i) => `${i + 1}) ${o.name}`).join('\n') + '\nNúmero:',
    );
    const target = lines[idx - 1];
    if (!target) continue;
    const newBoxes = (boxes.get(target.productCode) ?? 0) + 1;
    boxes.set(target.productCode, newBoxes);
    await driver.addLine(target.productCode, newBoxes * target.unitsPerBox);
    total = (await driver.readOrderTotal()).data ?? total;
  }

  // Discounts.
  for (const l of lines) {
    const b = boxes.get(l.productCode) ?? 0;
    if (platform.id === 'autoamerica') {
      const pct = platform.computeLineDiscount(b);
      if (pct > 0) await driver.applyDiscount(l.productCode, pct);
    } else if (platform.id === 'roberlo' && 'readMaxDiscount' in driver) {
      const pct = (await (driver as unknown as {
        readMaxDiscount(code: string): Promise<{ data?: number }>;
      }).readMaxDiscount(l.productCode)).data ?? 0;
      if (pct > 0) await driver.applyDiscount(l.productCode, pct);
    }
  }

  // Parcelas + save.
  total = (await driver.readOrderTotal()).data ?? total;
  const plan = platform.computeParcelas(total);
  await driver.setParcelas(plan);
  await driver.save();

  return { total, parcelas: plan.label };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/orcamento/orchestrator.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/orcamento/orchestrator.ts src/orcamento/orchestrator.test.ts
git commit -m "feat(agent-orcamento): orchestrator with min-value loop and discounts"
```

---

## Phase 8 — CLI wiring + end-to-end

### Task 15: CLI `run` command

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Write the CLI**

```ts
// src/cli/index.ts
#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { parseOrder } from '../orcamento/order.js';
import { AliasRepository } from '../db/alias-repository.js';
import { ConsolePrompter } from '../io/prompt.js';
import { autoamerica } from '../platforms/autoamerica.js';
import { roberlo } from '../platforms/roberlo.js';
import { realRunner } from '../platforms/agent-browser-runner.js';
import { AutoAmericaDriver } from '../platforms/autoamerica-driver.js';
import { RoberloDriver } from '../platforms/roberlo-driver.js';
import { resolveLine } from '../orcamento/resolver.js';
import { runOrcamento } from '../orcamento/orchestrator.js';
import type { IPortalDriver, Platform, PlatformConfig } from '../platforms/types.js';

const program = new Command();
program.name('agent-orcamento').description('Gera orçamentos nos portais Auto America / Roberlo');

program
  .command('run')
  .requiredOption('--platform <platform>', 'autoamerica | roberlo')
  .requiredOption('--order <file>', 'caminho do JSON do pedido')
  .action(async (opts: { platform: string; order: string }) => {
    const platformId = opts.platform as Platform;
    const { config, driver } = build(platformId);

    const order = parseOrder(JSON.parse(readFileSync(opts.order, 'utf-8')));
    const repo = new AliasRepository(process.env.ORCAMENTO_DB ?? './orcamento.db');
    const prompter = new ConsolePrompter();

    try {
      await driver.login();
      const lines = [];
      for (const line of order.produtos) {
        lines.push(await resolveLine(line, { platform: platformId, repo, driver, prompter }));
      }
      const result = await runOrcamento({ platform: config, client: order.client, lines, driver, prompter });
      console.log(`✅ Orçamento salvo. Total: ${result.total.toFixed(2)} — Parcelas: ${result.parcelas}`);
    } finally {
      repo.close();
      await realRunner(['close', '--all']);
    }
  });

function build(platformId: Platform): { config: PlatformConfig; driver: IPortalDriver } {
  if (platformId === 'autoamerica') {
    return {
      config: autoamerica,
      driver: new AutoAmericaDriver(realRunner, {
        url: process.env.AUTOAMERICA_URL!, user: process.env.AUTOAMERICA_USER!, pass: process.env.AUTOAMERICA_PASS!,
      }),
    };
  }
  if (platformId === 'roberlo') {
    return {
      config: roberlo,
      driver: new RoberloDriver(realRunner, {
        url: process.env.ROBERLO_URL!, user: process.env.ROBERLO_USER!, pass: process.env.ROBERLO_PASS!,
      }),
    };
  }
  throw new Error(`Plataforma inválida: ${platformId} (use autoamerica | roberlo)`);
}

program.parseAsync();
```

Note: `resolveLine` calls `driver.searchProducts` (needs a live session), and the orchestrator also logs in — to avoid a double login, the CLI logs in once up front and the orchestrator's `login()` should be idempotent (the driver's `login()` can early-return if already authenticated; confirm during live mapping). If double-login is a problem, remove the `driver.login()` call inside `runOrcamento` and document that the caller logs in.

- [ ] **Step 2: Verify it compiles and the binary parses args**

Run: `pnpm build && node dist/cli/index.js run --help`
Expected: prints the `run` command help with `--platform` and `--order`.

- [ ] **Step 3: End-to-end dry run (live, with a small order)**

Create `tmp/pedido-teste.json` with the real client and 1–2 known products. Run:
Run: `pnpm dev run --platform autoamerica --order tmp/pedido-teste.json`
Expected: logs in, prompts for any unknown product (search live, pick, units/box), adds lines, runs the min-value loop (prompts which to bump if needed), saves. If any driver step fails to find an element, STOP and ask the user.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(agent-orcamento): CLI run command wiring full flow"
```

### Task 16: Full verification

- [ ] **Step 1: Run the whole suite + build**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: all tests pass, build succeeds, no type errors.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A && git commit -m "chore(agent-orcamento): verification fixups" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 execution model → Tasks 14/15 (deterministic orchestrator + CLI). ✓
- §4 order JSON → Task 1. ✓
- §5 SQLite cache → Tasks 6–7. ✓
- §6 resolution + conversion → Tasks 2, 13. ✓
- §7 business rules (AA/Roberlo, min-value loop) → Tasks 4, 5, 14. ✓
- §8 driver action space → Tasks 3, 9–12. ✓
- §9 error/recovery + stop-and-ask → Tasks 11/12 (STOP-AND-ASK rule), 14 (iteration cap). ✓
- §10 security (.env) → Task 0. ✓
- §11 testing → tests in every core task. ✓
- §12 CLI → Task 15. ✓

**Placeholder scan:** Driver method bodies in Tasks 11/12 are intentionally mapped live (selectors unknown until then) and are gated by the STOP-AND-ASK rule; all other tasks contain complete code.

**Type consistency:** `DriverResult`, `IPortalDriver`, `ProductOption`, `StartQuoteOpts`, `ParcelaPlan` (Task 3); `ResolvedLine` (Task 13); `AliasRecord`/`SaveAliasInput` (Task 7); `Prompter` (Task 8) — all referenced consistently across resolver, orchestrator, and CLI. `readMaxDiscount` is Roberlo-only and accessed via `'readMaxDiscount' in driver` (Task 12/14), not on the shared interface.
