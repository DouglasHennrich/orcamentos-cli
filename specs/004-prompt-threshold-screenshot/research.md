# Research: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Feature**: `004-prompt-threshold-screenshot`
**Date**: 2026-06-09

---

## Decisão 1: Mecanismo de mutex para `ConsolePrompter`

**Decision**: Implementar mutex artesanal com Promise-chaining interno à `ConsolePrompter`, sem dependência nova.

**Rationale**: O projeto já usa `p-limit` para batch concurrency. Para o prompter, o padrão é ainda mais simples: manter `private _lock: Promise<void> = Promise.resolve()` e encadear cada operação como `.then(() => operação)`. Cada operação retorna uma nova Promise que se torna o novo `_lock`, garantindo fila FIFO automática.

**Alternatives considered**:
- `async-mutex` npm package: mais explícito, mas adiciona dependência para algo trivial
- Serialização no `batch-runner.ts`: muda a interface do Prompter e complica os callers

**Context prefix**: A interface `Prompter` não muda (FR-004). O contexto `[provider / cliente]` é injetado via método `withContext(prefix: string): Prompter` que retorna um wrapper thin delegando ao `ConsolePrompter` base com o prefixo concatenado nas perguntas. O wrapper não tem lock próprio — delega ao ConsolePrompter que centraliza o mutex.

---

## Decisão 2: Schema da tabela `product_rules` para threshold por produto específico

**Decision**: Nenhuma alteração de schema necessária. A constraint UNIQUE já é dinâmica no `save()` do `ProductRuleRepository` e inclui `product_code`. Um threshold específico por produto é apenas um row com `product_code = '<código_real>'` em vez de `'*'`.

**Rationale**: Ao inspecionar `src/db/product-rule-repository.ts:43-46`, a constraint de conflito já inclui `product_code`. Uma regra `threshold-discount` com `product_code = 'ABC123'` e `quantityValue = 5` é distinta de uma com `product_code = '*'` e `quantityValue = 5`. O banco aceita ambas sem mudança.

**Alternatives considered**:
- Novo campo `scope` ('global' | 'specific'): redundante — `product_code = '*'` já encoda o escopo
- DROP + CREATE table: desnecessário; o schema atual já suporta

---

## Decisão 3: Momento e path do screenshot automático

**Decision**: Adicionar `autoScreenshotDir?: string` ao `RunOrcamentoInput`. Antes de `driver.save()`, computar `<autoScreenshotDir>/<platform>/<sanitize(client.name)>.png` e capturar. Após o export, renomear para `<exportPath>.replace('.pdf', '.png')` se o nome diferir.

**Rationale**: O screenshot precisa ocorrer ANTES de `driver.save()`, mas o `clientName` definitivo do portal só é conhecido depois do export. Usar `client.name` (input) para path temporário e renomear pós-export garante que PDF + PNG sempre terão o mesmo nome base.

**Alternatives considered**:
- Refatorar `exportWriter` para retornar o path antecipado: muda a interface do `ExportWriter`
- Capturar após `driver.save()` mas antes de export: perde o estado visual do formulário preenchido

**Fallback**: Se o rename falhar, logar aviso e continuar — screenshot existirá com nome de `client.name` mesmo não coincidindo exatamente com o PDF.

---

## Decisão 4: Alias lookup para threshold por produto específico no wizard

**Decision**: No wizard, ao escolher "Produto específico", chamar `repo.findFuzzy(code)` do `AliasRepository`. Se não encontrar, criar o alias com `repo.upsert({ code, name })` sem exibir lista de seleção.

**Rationale**: O operador já conhece o código exato ao criar a regra (negociação prévia). Lookup serve apenas para verificar existência e criar se ausente. Fuzzy search com lista seria ruído neste contexto.

**Alternatives considered**:
- Lookup via `searchProducts` no portal: requer browser ativo; o `rules` editor roda independentemente de um run
- Exigir que alias já exista: penaliza operadores que ainda não rodaram orçamento com o produto
