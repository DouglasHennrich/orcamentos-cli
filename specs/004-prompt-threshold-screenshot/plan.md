# Implementation Plan: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Branch**: `004-prompt-threshold-screenshot` | **Date**: 2026-06-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-prompt-threshold-screenshot/spec.md`

## Summary

Três melhorias independentes ao CLI de orçamentos: (1) serialização de prompts interativos em batch paralelo via mutex interno no `ConsolePrompter` com prefixo de contexto `[provider / cliente]`; (2) extensão do wizard de regras `threshold-discount` para suportar escopo por produto específico além do global; (3) captura automática de screenshot full-page antes de salvar o orçamento, co-localizado com o PDF exportado.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 22+

**Primary Dependencies**: `enquirer` (wizard rules), `p-limit` (batch concurrency) — sem dependências novas

**Storage**: SQLite via `node:sqlite` — tabela `product_rules` existente sem mudança de schema

**Testing**: Vitest

**Target Platform**: macOS CLI (darwin, terminal interativo)

**Project Type**: CLI tool

**Constraints**: Interface `Prompter` não pode mudar (FR-004); zero migração de dados; sem novas dependências npm

## Constitution Check

- [x] **Principle II**: Nenhum driver modificado — screenshot usa `captureScreenshot` já existente; nenhuma lógica de portal vaza para o domínio
- [x] **Principle III**: TDD obrigatório — testes escritos antes da implementação para mutex, threshold scope e screenshot path
- [x] **Principle IV**: Falha de screenshot é tratada como aviso não-fatal (sem throw); consistente com Result pattern
- [x] **Principle V**: Mutex em `src/io/prompt.ts`; screenshot derivation em `src/orcamento/orchestrator.ts`; nenhuma IO direta em domínio puro

## Project Structure

### Documentação (esta feature)

```text
specs/004-prompt-threshold-screenshot/
├── plan.md          ← este arquivo
├── research.md      ← decisões técnicas
├── data-model.md    ← entidades e fluxos de dados
└── tasks.md         ← gerado por /speckit-tasks
```

### Arquivos a Modificar

```text
src/io/prompt.ts                        -- mutex + withContext()
src/orcamento/orchestrator.ts           -- autoScreenshotDir, threshold filter por productCode
src/cli/rules-editor.ts                 -- wizard threshold: escopo global vs específico
src/orcamento/batch-runner.ts           -- passar autoScreenshotDir + withContext por pedido
src/cli/index.ts                        -- repassar baseDir como autoScreenshotDir

tests/io/prompt.test.ts                 -- testes de mutex e withContext
tests/orcamento/orchestrator.test.ts    -- testes screenshot auto + threshold scope
tests/cli/rules-editor.test.ts          -- testes wizard threshold scope (novo arquivo)
```

---

## Fase 1: Prompt Mutex e withContext

### 1.1 Testes (escrever primeiro — TDD)

**Arquivo**: `tests/io/prompt.test.ts`

Casos a adicionar:
1. **mutex serial**: dois `ask()` concorrentes resolvem na ordem de chamada (FIFO)
2. **mutex mantido em re-prompt**: `askInt()` com entrada inválida mantém mutex até resposta válida
3. **withContext prefixo**: `withContext('[prov / cli]').ask('Pergunta')` → stdout recebe `[prov / cli] Pergunta `
4. **withContext delega mutex**: dois contextos diferentes enfileiram no mesmo `ConsolePrompter`
5. **sem regressão single order**: `ask()` com pedido único funciona identicamente ao comportamento atual

### 1.2 Implementação — `src/io/prompt.ts`

1. Adicionar `private _lock: Promise<void> = Promise.resolve()` à classe `ConsolePrompter`
2. Adicionar método privado `enqueue<T>(fn: () => Promise<T>): Promise<T>`:
   ```ts
   private enqueue<T>(fn: () => Promise<T>): Promise<T> {
     const result = this._lock.then(fn);
     this._lock = result.then(() => undefined, () => undefined);
     return result;
   }
   ```
3. Envolver cada método público (`ask`, `askInt`, `askInts`, `choose`) com `return this.enqueue(() => { ... })`
4. Adicionar método público `withContext(prefix: string): Prompter`:
   ```ts
   withContext(prefix: string): Prompter {
     return {
       ask: (q) => this.ask(`${prefix} ${q}`),
       askInt: (q) => this.askInt(`${prefix} ${q}`),
       askInts: (q) => this.askInts(`${prefix} ${q}`),
       choose: (q, opts) => this.choose(`${prefix} ${q}`, opts),
     };
   }
   ```

### 1.3 Integração — `src/orcamento/batch-runner.ts`

1. Para cada pedido criar contexto: `prompter.withContext(\`[${order.provider} / ${order.client.name}]\`)`
2. Passar como `prompter` na chamada de `runOrcamento`
3. Remover comentário sobre serialização serial — o mutex resolve automaticamente em paralelo

---

## Fase 2: Threshold-discount com Escopo por Produto

### 2.1 Testes (escrever primeiro — TDD)

**Arquivo**: `tests/orcamento/orchestrator.test.ts`

Casos a adicionar:
1. **threshold global aplica a qualquer produto**: regra `productCode='*'`, produto A com qty ≥ threshold → desconto aplicado
2. **threshold específico só ao produto correto**: regra `productCode='ABC'`, produto ABC → desconto; produto XYZ mesmo qty → sem desconto da regra
3. **específico tem prioridade sobre global**: ambas ativas mesmo threshold, produto ABC → usa desconto da específica

**Arquivo**: `tests/cli/rules-editor.test.ts` (novo)

1. **wizard global**: escolhe "Todos os produtos" → `repo.save` com `productCode='*'`
2. **wizard específico sem alias**: informa código + nome → `aliasRepo.upsert` chamado → `repo.save` com código real
3. **wizard específico com alias existente**: código já no DB → `aliasRepo.upsert` não chamado, `repo.save` com código real

### 2.2 Implementação — `src/orcamento/orchestrator.ts`

Alterar filtro de threshold (~linha 276):

```ts
// Antes:
.filter(r => r.type === 'threshold-discount' && r.quantityValue !== undefined && b >= r.quantityValue)

// Depois:
.filter(r =>
  r.type === 'threshold-discount' &&
  r.quantityValue !== undefined &&
  b >= r.quantityValue &&
  (r.productCode === '*' || r.productCode === l.productCode)
)
```

### 2.3 Implementação — `src/cli/rules-editor.ts`

No bloco `addRule` para `threshold-discount` (~linha 133), inserir passo de escopo:

```ts
const scopeSelect = new Select({
  name: 'scope',
  message: 'Aplicar desconto a:',
  choices: [
    { name: 'global', message: 'Todos os produtos (global)' },
    { name: 'specific', message: 'Produto específico' },
  ],
});
const scope = await scopeSelect.run();

let productCode = '*';
if (scope === 'specific') {
  const codeInput = new Input({ message: 'Código do produto:' });
  productCode = await codeInput.run();
  const nameInput = new Input({ message: 'Nome do produto:' });
  const productName = await nameInput.run();
  const existing = aliasRepo.findByCode(productCode);
  if (!existing) aliasRepo.upsert(productCode, productName);
}
// prosseguir com quantityValue e discountPct
repo.save({ provider, type, productCode, quantityValue, discountPct });
```

`addRule` e `runRulesEditor` recebem `aliasRepo: AliasRepository` como parâmetro adicional.

### 2.4 Atualizar display — `src/cli/rules-editor.ts` (~linha 37)

```ts
const scope = r.productCode === '*' ? 'global' : `produto ${r.productCode}`;
details = `Desconto por qtd (${scope}): >=${r.quantityValue} cx -> ${r.discountPct}%`;
```

---

## Fase 3: Screenshot Automático de Auditoria

### 3.1 Testes (escrever primeiro — TDD)

**Arquivo**: `tests/orcamento/orchestrator.test.ts`

Casos a adicionar:
1. **screenshot antes de save**: `autoScreenshotDir` definido → `captureScreenshot` chamado antes de `driver.save()`
2. **path renomeado para coincidir com PDF**: screenshot movido para `exportPath.replace('.pdf', '.png')`
3. **falha não-fatal**: `captureScreenshot` retorna erro → aviso logado, save e export continuam normalmente
4. **dry-run sem screenshot**: `dryRun=true` com `autoScreenshotDir` → `captureScreenshot` não chamado
5. **screenshotPath explícito sobrescreve auto**: ambos definidos → usa `screenshotPath` explícito

### 3.2 Implementação — `src/orcamento/orchestrator.ts`

1. Adicionar `autoScreenshotDir?: string` ao tipo `RunOrcamentoInput`
2. Determinar path efetivo antes de `driver.save()`:

```ts
let effectiveScreenshotPath: string | undefined = screenshotPath;
if (!effectiveScreenshotPath && autoScreenshotDir && !dryRun) {
  const tempName = sanitizeFileName(client.name) || 'orcamento';
  effectiveScreenshotPath = resolve(autoScreenshotDir, platform.id, `${tempName}.png`);
  await mkdir(dirname(effectiveScreenshotPath), { recursive: true });
}

if (effectiveScreenshotPath && !dryRun) {
  if (!driver.captureScreenshot) {
    console.warn('Driver não suporta screenshot; pulando.');
    effectiveScreenshotPath = undefined;
  } else {
    const result = await driver.captureScreenshot(effectiveScreenshotPath);
    if (result.status === 'error') {
      console.warn(`Aviso: screenshot falhou — ${result.summary}`);
      effectiveScreenshotPath = undefined;
    }
  }
}
```

3. Após `exportWriter` retornar `exportPath`, renomear se necessário:

```ts
if (effectiveScreenshotPath && !screenshotPath) {
  const finalPngPath = exportPath.replace(/\.pdf$/i, '.png');
  if (effectiveScreenshotPath !== finalPngPath) {
    try { await rename(effectiveScreenshotPath, finalPngPath); }
    catch { console.warn(`Aviso: não foi possível renomear screenshot para ${finalPngPath}`); }
  }
  console.log(`Screenshot de auditoria: ${finalPngPath}`);
}
```

4. Importar `rename` de `node:fs/promises` e `sanitizeFileName` de `../io/export-writer.js`

### 3.3 Integração — `src/cli/index.ts` e `src/orcamento/batch-runner.ts`

- `index.ts`: passar o `baseDir` do export writer como `autoScreenshotDir` ao `runBatch`
- `batch-runner.ts`: repassar `autoScreenshotDir` para cada `runOrcamento`

---

## Ordem de Implementação

| Fase | Independência | Risco |
|------|--------------|-------|
| 1 — Mutex | Independente | Baixo — additive, sem mudança de interface |
| 2 — Threshold scope | Independente | Baixo — branch no wizard + um filtro |
| 3 — Screenshot | Depende da Fase 1 (batch-runner) | Médio — envolve filesystem e rename |

Cada fase pode ser commitada separadamente.
