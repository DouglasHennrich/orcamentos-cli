# Data Model: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Feature**: `004-prompt-threshold-screenshot`
**Date**: 2026-06-09

---

## Entidades Modificadas

### ConsolePrompter (`src/io/prompt.ts`)

**Campos novos**:
```
_lock: Promise<void>        -- fila FIFO interna (mutex por Promise-chaining)
```

**Métodos novos**:
```
withContext(prefix: string): Prompter
  -- retorna wrapper thin que prefixa todas as perguntas com prefix
  -- delega ao ConsolePrompter base (incluindo o mutex)
  -- compatível com a interface Prompter sem modificá-la
```

**Mudança comportamental**: `ask()`, `askInt()`, `askInts()`, `choose()` passam a ser enfileirados via `_lock` antes de escrever em stdout. A interface `Prompter` não muda.

---

### ProductRule (`src/db/product-rule-repository.ts`)

**Sem mudança de schema**. A tabela `product_rules` já suporta `product_code` variável.

**Mudança comportamental no orchestrator**:
- Filtro de threshold-discount passa de "qualquer threshold-discount ativo" para "threshold-discount ativo com `productCode === '*'` OU `productCode === linha.productCode`"

**Mudança no wizard** (`src/cli/rules-editor.ts`):
- Para `type = 'threshold-discount'`, adicionar passo de escopo com opção de `productCode` real além de `'*'`

---

### RunOrcamentoInput (`src/orcamento/orchestrator.ts`)

**Campo novo**:
```
autoScreenshotDir?: string  -- diretório base para screenshot automático
                             -- quando definido e não-dryRun: captura antes de save()
                             -- path temporário: <dir>/<platform>/<sanitize(client.name)>.png
                             -- renomeado para <exportPath>.replace('.pdf','.png') após export
```

**Campo existente (preservado)**:
```
screenshotPath?: string     -- path explícito via --screenshot (prioridade sobre autoScreenshotDir)
```

**Precedência**:
1. `screenshotPath` explícito → usa diretamente (comportamento atual)
2. `autoScreenshotDir` definido → deriva path automaticamente
3. Nenhum → nenhum screenshot

---

## Fluxo de dados: screenshot automático

```
RunOrcamentoInput.autoScreenshotDir
  ↓ [antes de driver.save()]
  computar: dir/platform/sanitize(client.name).png
  driver.captureScreenshot(tempPath)  → warn se falhar, continuar
  ↓ [após exportWriter()]
  exportPath = "public/orcamentos/autoamerica/CLIENTE.pdf"
  finalPngPath = exportPath.replace('.pdf', '.png')
  rename(tempPath → finalPngPath) se diferente
```

---

## Fluxo de dados: threshold-discount com produto específico

```
rules-editor addRule(threshold-discount)
  → escopo: (1) Todos os produtos → productCode = '*'
            (2) Produto específico → pede código + nome
                aliasRepo.findByCode(code) → existe? usa : cria alias
                productCode = código_real

orchestrator (aplicação de desconto por linha)
  → thresholdRules = rules.filter(r =>
       r.type === 'threshold-discount' &&
       (r.productCode === '*' || r.productCode === linha.productCode) &&
       (r.quantityValue ?? 0) <= qtdCaixas
     ).sort(desc por discountPct)
  → aplica bestTier.discountPct
```

---

## Fluxo de dados: prompt mutex com contexto

```
batch-runner
  → cria 1x ConsolePrompter (compartilhado entre todos os pedidos)
  → pedido A: prompter.withContext('[autoamerica / CLIENTE ABC]') → ctxA
  → pedido B: prompter.withContext('[roberlo / DISTRIBUIDORA XYZ]') → ctxB
  → ctxA e ctxB delegam ao mesmo ConsolePrompter com _lock

orchestrator/resolver chama ctxA.ask('Produto não encontrado...')
  → ConsolePrompter._lock: aguarda vez
  → exibe: '[autoamerica / CLIENTE ABC] Produto não encontrado...'
  → lê stdin
  → libera _lock → pedido B recebe a vez
```
