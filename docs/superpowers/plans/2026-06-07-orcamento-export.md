# Export do Orçamento Pós-Save — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Após `driver.save()` e o redirecionamento para a listagem, baixar o PDF do orçamento recém-criado para `public/orcamentos/<provider>/<cliente>.pdf`, sempre (export obrigatório).

**Architecture:** Um helper compartilhado (`exportLastQuote`) executa, na sessão autenticada já posicionada na listagem, a ação `PrtOrc(rec)` da primeira linha (gera o PDF via `U_MailOrc.apw`) e baixa os bytes em base64. Cada driver expõe `exportQuote()` delegando ao helper. Um `ExportWriter` injetado no orchestrator grava o arquivo no disco. Drivers permanecem "só browser"; o IO de arquivo fica isolado e testável.

**Tech Stack:** TypeScript (ESM, `.js` nos imports), Node `fs/promises`, Vitest, agent-browser CLI (via runner stubável).

**Spec:** `docs/superpowers/specs/2026-06-07-orcamento-export-design.md`

---

## Contexto essencial para quem não conhece o código

- **Drivers** (`src/platforms/autoamerica-driver.ts`, `roberlo-driver.ts`) implementam `IPortalDriver` (`src/platforms/types.ts`). Cada um tem um método privado `evalRaw(js)` que roda JS na página via agent-browser e retorna o valor serializado.
- **`evalRaw` decodifica uma camada de JSON**: o agent-browser serializa o retorno do `eval` como JSON. Convenção do projeto: a página retorna `JSON.stringify(obj)` (uma string), e quem consome faz `JSON.parse(await evalRaw(js))` para recuperar o objeto (veja `evalJson` nos drivers).
- **Padrão de chamada AJAX síncrona** já usado em `addLine` (`jQuery.ajax({ async:false })`) para obter resultado dentro de um único `eval`.
- **Orchestrator** (`src/orcamento/orchestrator.ts`) recebe dependências injetadas (`driver`, `prompter`, `repo`) — vamos adicionar `exportWriter`.
- **Testes** usam Vitest. O orchestrator é testado com um driver stub (objeto com `vi.fn()`s) em `src/orcamento/orchestrator.test.ts`.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/platforms/types.ts` | Modificar | Adicionar `ExportedQuote` e `exportQuote()` na interface |
| `src/platforms/driver-helpers.ts` | Modificar | Adicionar `exportLastQuote(evalRaw)` (lógica de portal compartilhada) |
| `src/platforms/driver.test.ts` | Modificar | Testes de `exportLastQuote` |
| `src/platforms/autoamerica-driver.ts` | Modificar | Implementar `exportQuote()` |
| `src/platforms/roberlo-driver.ts` | Modificar | Implementar `exportQuote()` |
| `src/platforms/export-driver.test.ts` | Criar | Testes de `exportQuote()` nos dois drivers (runner stubado) |
| `src/io/export-writer.ts` | Criar | `makeExportWriter` + `sanitizeFileName` (grava o PDF no disco) |
| `src/io/export-writer.test.ts` | Criar | Testes do writer |
| `src/orcamento/orchestrator.ts` | Modificar | Chamar `exportQuote` + `exportWriter` após `save` |
| `src/orcamento/orchestrator.test.ts` | Modificar | Stub de `exportQuote`/`exportWriter`, novos asserts |
| `src/cli/index.ts` | Modificar | Instanciar `makeExportWriter` e imprimir `exportPath` |

---

## Task 1: Tipo `ExportedQuote` + helper `exportLastQuote`

**Files:**
- Modify: `src/platforms/types.ts`
- Modify: `src/platforms/driver-helpers.ts`
- Test: `src/platforms/driver.test.ts`

- [ ] **Step 1: Adicionar o tipo `ExportedQuote` em `types.ts`**

Em `src/platforms/types.ts`, logo após a interface `ProductOption` (linha ~20), adicione:

```ts
export interface ExportedQuote {
  /** Conteúdo do PDF do orçamento, codificado em base64. */
  pdfBase64: string;
  /** Número do orçamento exibido na listagem (ex.: "098171"). */
  orcamentoNumber: string;
  /** Nome do cliente como aparece na listagem (coluna "Nome"). */
  clientName: string;
}
```

- [ ] **Step 2: Escrever o teste do helper (falhando)**

Em `src/platforms/driver.test.ts`, adicione no topo o import e um novo bloco `describe`:

```ts
import { parseDropdownOptions, parseBRL, exportLastQuote } from './driver-helpers.js';

describe('exportLastQuote', () => {
  it('parses the export payload returned by the page', async () => {
    const payload = JSON.stringify({
      rec: '2050753',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
      filename: 'orcamento_2050753.pdf',
      pdfBase64: 'JVBERi0=',
    });
    const evalRaw = async () => payload;
    const result = await exportLastQuote(evalRaw);
    expect(result).toEqual({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
    });
  });

  it('throws when the page reports an error', async () => {
    const evalRaw = async () => JSON.stringify({ error: 'listagem vazia' });
    await expect(exportLastQuote(evalRaw)).rejects.toThrow(/listagem vazia/);
  });

  it('throws when the PDF is empty', async () => {
    const evalRaw = async () =>
      JSON.stringify({ orcamentoNumber: '1', clientName: 'X', pdfBase64: '' });
    await expect(exportLastQuote(evalRaw)).rejects.toThrow(/PDF vazio/);
  });
});
```

Note: `import { describe, it, expect } from 'vitest';` já existe no topo do arquivo — não duplicar.

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm test -- driver.test.ts`
Expected: FAIL — `exportLastQuote is not a function` / não exportado.

- [ ] **Step 4: Implementar `exportLastQuote` em `driver-helpers.ts`**

No topo de `src/platforms/driver-helpers.ts`, ajuste o import de tipos:

```ts
import type { ProductOption, ExportedQuote } from './types.js';
```

E adicione ao final do arquivo:

```ts
/**
 * JS executado na página (listagem U_orcamento.apw) para exportar o orçamento
 * da primeira linha. Replica PrtOrc(rec) de forma síncrona e baixa o PDF em base64.
 * Retorna SEMPRE JSON.stringify(...) — { rec, orcamentoNumber, clientName, filename, pdfBase64 } ou { error }.
 */
const EXPORT_JS = `(function () {
  try {
    var rows = document.querySelectorAll('table tbody tr');
    if (!rows.length) return JSON.stringify({ error: 'listagem vazia' });
    var tr = rows[0];
    var printA = Array.from(tr.querySelectorAll('a')).find(function (a) {
      return (a.getAttribute('onclick') || '').indexOf('PrtOrc') >= 0;
    });
    var recMatch = printA ? (printA.getAttribute('onclick') || '').match(/PrtOrc\\((\\d+)\\)/) : null;
    var rec = recMatch ? recMatch[1] : '';
    if (!rec) return JSON.stringify({ error: 'rec nao encontrado na primeira linha' });

    var headers = Array.from(document.querySelectorAll('table thead th')).map(function (th) {
      return th.textContent.trim().toLowerCase();
    });
    var orcIdx = headers.findIndex(function (h) { return h.indexOf('or') === 0 && h.indexOf('amento') >= 0; });
    var nomeIdx = headers.findIndex(function (h) { return h === 'nome'; });
    var tds = tr.querySelectorAll('td');
    var orcamentoNumber = orcIdx >= 0 && tds[orcIdx] ? tds[orcIdx].textContent.trim() : '';
    var clientName = nomeIdx >= 0 && tds[nomeIdx] ? tds[nomeIdx].textContent.trim() : '';

    var pr = new URLSearchParams(location.search).get('PR') || '';
    var url = 'U_MailOrc.apw' + (pr ? '?PR=' + encodeURIComponent(pr) + '&opc=print' : '?opc=print');
    var filename = '';
    jQuery.ajax({
      type: 'POST', async: false, cache: false, url: url,
      data: 'opc=print&doc=' + rec,
      success: function (d) { filename = (typeof d === 'string') ? d.trim() : ''; }
    });
    if (filename.indexOf('orcamento') !== 0) {
      return JSON.stringify({ error: 'resposta inesperada de U_MailOrc: ' + String(filename).slice(0, 80) });
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/anexos/orcamentos/' + filename, false);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.send(null);
    if (xhr.status !== 200) return JSON.stringify({ error: 'download falhou (status ' + xhr.status + ')' });
    var bin = xhr.responseText;
    var out = '';
    for (var i = 0; i < bin.length; i++) { out += String.fromCharCode(bin.charCodeAt(i) & 0xff); }
    var pdfBase64 = btoa(out);

    return JSON.stringify({ rec: rec, orcamentoNumber: orcamentoNumber, clientName: clientName, filename: filename, pdfBase64: pdfBase64 });
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;

interface ExportPayload {
  rec?: string;
  orcamentoNumber?: string;
  clientName?: string;
  filename?: string;
  pdfBase64?: string;
  error?: string;
}

/**
 * Exporta o orçamento da primeira linha da listagem.
 * `evalRaw` é o método do driver que roda JS na página (sessão autenticada,
 * já posicionada em U_orcamento.apw após o save).
 */
export async function exportLastQuote(
  evalRaw: (js: string) => Promise<string>,
): Promise<ExportedQuote> {
  const payload = JSON.parse(await evalRaw(EXPORT_JS)) as ExportPayload;
  if (payload.error) throw new Error(`Falha no export: ${payload.error}`);
  if (!payload.pdfBase64) throw new Error('Falha no export: PDF vazio');
  return {
    pdfBase64: payload.pdfBase64,
    orcamentoNumber: payload.orcamentoNumber ?? '',
    clientName: payload.clientName ?? '',
  };
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm test -- driver.test.ts`
Expected: PASS (3 novos testes verdes).

- [ ] **Step 6: Commit**

```bash
git add src/platforms/types.ts src/platforms/driver-helpers.ts src/platforms/driver.test.ts
git commit -m "feat(agent-orcamento): exportLastQuote helper + ExportedQuote type"
```

---

## Task 2: Método `exportQuote()` na interface e nos dois drivers

**Files:**
- Modify: `src/platforms/types.ts`
- Modify: `src/platforms/autoamerica-driver.ts`
- Modify: `src/platforms/roberlo-driver.ts`
- Test: `src/platforms/export-driver.test.ts` (criar)

- [ ] **Step 1: Escrever o teste dos dois drivers (falhando)**

Crie `src/platforms/export-driver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AutoAmericaDriver } from './autoamerica-driver.js';
import { RoberloDriver } from './roberlo-driver.js';
import type { AgentBrowserRunner, RunResult } from './agent-browser-runner.js';

// Reproduz a dupla serialização do agent-browser: a página retorna JSON.stringify(obj),
// e o agent-browser serializa essa string de novo como JSON.
function enc(obj: unknown): string {
  return JSON.stringify(JSON.stringify(obj));
}

function runnerReturning(payload: unknown): AgentBrowserRunner {
  return async (): Promise<RunResult> => ({ stdout: enc(payload), stderr: '', code: 0 });
}

const okPayload = {
  rec: '2050753',
  orcamentoNumber: '098171',
  clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
  filename: 'orcamento_2050753.pdf',
  pdfBase64: 'JVBERi0=',
};

describe('AutoAmericaDriver.exportQuote', () => {
  it('returns success with the exported quote data', async () => {
    const driver = new AutoAmericaDriver(runnerReturning(okPayload), 'u', 'p');
    const res = await driver.exportQuote();
    expect(res.status).toBe('success');
    expect(res.data).toEqual({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
    });
  });

  it('returns error status when the page reports an error', async () => {
    const driver = new AutoAmericaDriver(runnerReturning({ error: 'listagem vazia' }), 'u', 'p');
    const res = await driver.exportQuote();
    expect(res.status).toBe('error');
    expect(res.summary).toMatch(/listagem vazia/);
  });
});

describe('RoberloDriver.exportQuote', () => {
  it('returns success with the exported quote data', async () => {
    const driver = new RoberloDriver(runnerReturning(okPayload), 'u', 'p');
    const res = await driver.exportQuote();
    expect(res.status).toBe('success');
    expect(res.data?.orcamentoNumber).toBe('098171');
  });
});
```

- [ ] **Step 2: Adicionar `exportQuote` à interface `IPortalDriver`**

Em `src/platforms/types.ts`, dentro de `interface IPortalDriver`, logo após `save(): Promise<DriverResult>;`:

```ts
  /** Exporta (baixa o PDF) do orçamento recém-criado, lendo a 1ª linha da listagem. */
  exportQuote(): Promise<DriverResult<ExportedQuote>>;
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm test -- export-driver.test.ts`
Expected: FAIL — `exportQuote` não existe nos drivers (erro de tipo/método ausente).

- [ ] **Step 4: Implementar `exportQuote` no AutoAmericaDriver**

Em `src/platforms/autoamerica-driver.ts`:

Ajuste os imports do topo:

```ts
import type { IPortalDriver, StartQuoteOpts, DriverResult, ProductOption, ParcelaPlan, ExportedQuote } from './types.js';
import { parseBRL, exportLastQuote } from './driver-helpers.js';
```

E adicione o método logo após `save()` (antes do fechamento da classe `}`):

```ts
  async exportQuote(): Promise<DriverResult<ExportedQuote>> {
    try {
      const data = await exportLastQuote((js) => this.evalRaw(js));
      return {
        status: 'success',
        summary: `Orçamento ${data.orcamentoNumber} exportado (${data.clientName})`,
        data,
      };
    } catch (e) {
      return { status: 'error', summary: `Falha ao exportar orçamento: ${(e as Error).message}` };
    }
  }
```

- [ ] **Step 5: Implementar `exportQuote` no RoberloDriver**

Em `src/platforms/roberlo-driver.ts`:

Ajuste os imports do topo:

```ts
import type { IPortalDriver, StartQuoteOpts, DriverResult, ProductOption, ParcelaPlan, ExportedQuote } from './types.js';
import { parseBRL, exportLastQuote } from './driver-helpers.js';
```

E adicione o método logo após `save()` (antes do fechamento da classe `}`):

```ts
  async exportQuote(): Promise<DriverResult<ExportedQuote>> {
    try {
      const data = await exportLastQuote((js) => this.evalRaw(js));
      return {
        status: 'success',
        summary: `Orçamento ${data.orcamentoNumber} exportado (${data.clientName})`,
        data,
      };
    } catch (e) {
      return { status: 'error', summary: `Falha ao exportar orçamento: ${(e as Error).message}` };
    }
  }
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm test -- export-driver.test.ts`
Expected: PASS (3 testes verdes).

- [ ] **Step 7: Commit**

```bash
git add src/platforms/types.ts src/platforms/autoamerica-driver.ts src/platforms/roberlo-driver.ts src/platforms/export-driver.test.ts
git commit -m "feat(agent-orcamento): exportQuote() nos drivers AA e Roberlo"
```

---

## Task 3: Writer de arquivo (`export-writer.ts`)

**Files:**
- Create: `src/io/export-writer.ts`
- Test: `src/io/export-writer.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `src/io/export-writer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeExportWriter, sanitizeFileName } from './export-writer.js';

describe('sanitizeFileName', () => {
  it('replaces invalid filesystem characters and trims', () => {
    expect(sanitizeFileName('ACME / LTDA: "X"')).toBe('ACME LTDA X');
  });
  it('falls back to "orcamento" when the name is empty after sanitizing', () => {
    expect(sanitizeFileName('   ')).toBe('orcamento');
  });
});

describe('makeExportWriter', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'export-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the decoded PDF to <baseDir>/<platform>/<client>.pdf', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('%PDF-1.4 fake').toString('base64');
    const path = await writer({ platform: 'autoamerica', clientName: 'ZIKALIMP LTDA', pdfBase64 });

    expect(path).toBe(join(dir, 'autoamerica', 'ZIKALIMP LTDA.pdf'));
    const written = await readFile(path);
    expect(written.toString()).toBe('%PDF-1.4 fake');
  });

  it('uses the provider folder per platform', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('x').toString('base64');
    const path = await writer({ platform: 'roberlo', clientName: 'CASA DO CARRO', pdfBase64 });
    expect(path).toBe(join(dir, 'roberlo', 'CASA DO CARRO.pdf'));
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm test -- export-writer.test.ts`
Expected: FAIL — módulo `./export-writer.js` não existe.

- [ ] **Step 3: Implementar `export-writer.ts`**

Crie `src/io/export-writer.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Platform } from '../platforms/types.js';

export interface ExportWriterInput {
  platform: Platform;
  /** Nome do cliente vindo do portal (coluna "Nome" da listagem). */
  clientName: string;
  pdfBase64: string;
}

export type ExportWriter = (input: ExportWriterInput) => Promise<string>;

/** Remove caracteres inválidos de nome de arquivo; volta para "orcamento" se vazio. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'orcamento';
}

/**
 * Cria um writer que grava o PDF em `<baseDir>/<platform>/<cliente>.pdf`.
 * baseDir default: env ORCAMENTO_EXPORT_DIR ou "public/orcamentos".
 */
export function makeExportWriter(
  baseDir: string = process.env.ORCAMENTO_EXPORT_DIR ?? 'public/orcamentos',
): ExportWriter {
  return async ({ platform, clientName, pdfBase64 }) => {
    const filePath = resolve(baseDir, platform, `${sanitizeFileName(clientName)}.pdf`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(pdfBase64, 'base64'));
    return filePath;
  };
}
```

Nota: o teste compara com `join(dir, ...)` e `dir` vem de `mkdtemp` (caminho absoluto), então `resolve(baseDir, ...)` produz exatamente esse caminho.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm test -- export-writer.test.ts`
Expected: PASS (4 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add src/io/export-writer.ts src/io/export-writer.test.ts
git commit -m "feat(agent-orcamento): export-writer grava PDF em public/orcamentos/<provider>/<cliente>.pdf"
```

---

## Task 4: Integração no orchestrator

**Files:**
- Modify: `src/orcamento/orchestrator.ts`
- Test: `src/orcamento/orchestrator.test.ts`

- [ ] **Step 1: Atualizar o stub e os testes do orchestrator (falhando)**

Em `src/orcamento/orchestrator.test.ts`:

(a) No `priceModelDriver`, adicione `exportQuote` ao objeto retornado, logo após `save: vi.fn(...)`:

```ts
    save: vi.fn(async () => ok()),
    exportQuote: vi.fn(async () => ok({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'CLIENTE STUB',
    })),
```

(b) Crie um helper de `exportWriter` stub no topo do `describe` (ou logo antes dele):

```ts
const stubExportWriter = () => vi.fn(async () => '/tmp/orc/CLIENTE STUB.pdf');
```

(c) Em CADA chamada de `runOrcamento({...})` nos 3 testes existentes, adicione `exportWriter: stubExportWriter(),` ao objeto de input (junto com `driver`, `prompter`, `repo`).

(d) Adicione dois novos testes ao final do bloco `describe('runOrcamento', ...)`:

```ts
  it('exports the quote after saving and returns the written path', async () => {
    const driver = priceModelDriver({ A: 3000 });
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn() };
    const exportWriter = vi.fn(async () => '/out/autoamerica/CLIENTE STUB.pdf');
    const result = await runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter,
    });
    expect(driver.exportQuote).toHaveBeenCalled();
    expect(exportWriter).toHaveBeenCalledWith({
      platform: 'autoamerica',
      clientName: 'CLIENTE STUB',
      pdfBase64: 'JVBERi0=',
    });
    expect(result.exportPath).toBe('/out/autoamerica/CLIENTE STUB.pdf');
  });

  it('throws when the mandatory export fails', async () => {
    const driver = priceModelDriver({ A: 3000 });
    driver.exportQuote = vi.fn(async () => ({ status: 'error' as const, summary: 'listagem vazia' }));
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn() };
    await expect(runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter: stubExportWriter(),
    })).rejects.toThrow(/export obrigat/i);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm test -- orchestrator.test.ts`
Expected: FAIL — `exportWriter` não é tipo conhecido em `RunOrcamentoInput` / `result.exportPath` é `undefined` / não lança erro.

- [ ] **Step 3: Implementar a integração no orchestrator**

Em `src/orcamento/orchestrator.ts`:

(a) Adicione o import (junto aos outros imports de tipo do topo):

```ts
import type { ExportWriter } from '../io/export-writer.js';
```

(b) Em `RunOrcamentoInput`, adicione o campo:

```ts
  repo: AliasRepository;
  exportWriter: ExportWriter;
}
```

(c) Em `RunOrcamentoResult`, adicione `exportPath`:

```ts
export interface RunOrcamentoResult { total: number; parcelas: string; exportPath: string; }
```

(d) Em `const { ... } = input;` (linha ~22), inclua `exportWriter`:

```ts
  const { platform, client, orderLines, driver, prompter, repo, exportWriter } = input;
```

(e) Substitua o bloco final (a partir de `await driver.save();`) por:

```ts
  await driver.save();

  // Export obrigatório: baixa o PDF do orçamento recém-salvo da listagem.
  const exported = await driver.exportQuote();
  if (exported.status !== 'success' || !exported.data) {
    throw new Error(
      `Falha no export obrigatório do orçamento (já salvo na listagem): ${exported.summary}`,
    );
  }
  const exportPath = await exportWriter({
    platform: platform.id,
    clientName: exported.data.clientName,
    pdfBase64: exported.data.pdfBase64,
  });

  return { total, parcelas: plan.label, exportPath };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm test -- orchestrator.test.ts`
Expected: PASS (3 testes originais + 2 novos verdes).

- [ ] **Step 5: Commit**

```bash
git add src/orcamento/orchestrator.ts src/orcamento/orchestrator.test.ts
git commit -m "feat(agent-orcamento): orchestrator exporta o orçamento (obrigatório) após salvar"
```

---

## Task 5: Wiring na CLI

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Adicionar o import do writer**

Em `src/cli/index.ts`, junto aos outros imports (após o import de `ConsolePrompter`):

```ts
import { makeExportWriter } from '../io/export-writer.js';
```

- [ ] **Step 2: Instanciar e injetar o writer**

Logo após `const prompter = new ConsolePrompter();` (linha ~67), adicione:

```ts
    const exportWriter = makeExportWriter();
```

E na chamada `runOrcamento({...})`, adicione `exportWriter,` ao objeto de input (após `repo,`):

```ts
      const result = await runOrcamento({
        platform: platformConfig,
        client: order.client,
        orderLines: order.produtos,
        driver,
        prompter,
        repo,
        exportWriter,
      });
```

- [ ] **Step 3: Imprimir o caminho exportado no resumo**

Após `console.log(\`Parcelas: ${result.parcelas}\`);` (linha ~81), adicione:

```ts
      console.log(`PDF exportado: ${result.exportPath}`);
```

- [ ] **Step 4: Verificar build e type-check**

Run: `pnpm lint && pnpm build`
Expected: sem erros de tipo; build gera `dist/` sem falhas.

- [ ] **Step 5: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos os testes verdes (incluindo os novos das Tasks 1–4).

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(agent-orcamento): CLI injeta export-writer e imprime caminho do PDF"
```

---

## Verificação final (após todas as tasks)

- [ ] `pnpm test` — verde
- [ ] `pnpm build` — sem erros
- [ ] `pnpm lint` — sem erros (no projeto, `lint` = `tsc --noEmit`)
- [ ] Atualizar `PROGRESSO.md` com a feature de export (opcional, fora do escopo de código)

## Notas de design já decididas (não reabrir)

- **Export obrigatório**: sem flag para desativar. Falha → erro explícito (orçamento já está salvo).
- **Nome do arquivo**: vem da coluna "Nome" da listagem (nome preenchido na tela do orçamento), não do termo do JSON do pedido.
- **Identificação do orçamento**: primeira linha da listagem (ordem desc, escopo do representante logado).
- **`ExportedQuote` mora em `types.ts`** (não em `driver-helpers.ts`) para evitar import circular.
