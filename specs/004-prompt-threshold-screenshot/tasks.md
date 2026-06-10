---
description: "Task list for 004-prompt-threshold-screenshot"
---

# Tasks: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Input**: Design documents from `specs/004-prompt-threshold-screenshot/`

**Branch**: `004-prompt-threshold-screenshot`

**Tests**: Obrigatórios (TDD — Constitution Principle III). Escrever testes antes da implementação em cada fase.

**Organization**: Tarefas agrupadas por user story para implementação e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências pendentes)
- **[Story]**: User story correspondente (US1, US2, US3)

---

## Phase 1: Setup (Infraestrutura Compartilhada)

**Purpose**: Verificação de baseline antes de qualquer implementação

- [ ] T001 Verificar que `pnpm test` passa sem erros (baseline)
- [ ] T002 Verificar que `pnpm build` compila sem erros

**Checkpoint**: Ambiente limpo — implementação pode começar

---

## Phase 2: Foundational (Pré-requisito Bloqueante)

Não há pré-requisito bloqueante entre as três user stories — US1, US2 e US3 são completamente independentes entre si.

---

## Phase 3: User Story 1 — Batch Paralelo Sem Prompts Embaralhados (Priority: P1) 🎯 MVP

**Goal**: Serializar prompts do `ConsolePrompter` via mutex Promise-chaining; adicionar prefixo de contexto via `withContext()`.

**Independent Test**: `pnpm test tests/io/prompt.test.ts` — todos os casos de mutex e withContext passando.

### Testes (escrever primeiro)

- [ ] T003 [US1] Adicionar caso "mutex serial: dois ask() concorrentes resolvem em FIFO" em `tests/io/prompt.test.ts`
- [ ] T004 [US1] Adicionar caso "mutex mantido em re-prompt: askInt() com entrada inválida segura mutex até resposta válida" em `tests/io/prompt.test.ts`
- [ ] T005 [US1] Adicionar caso "withContext prefixo: question recebe prefixo concatenado" em `tests/io/prompt.test.ts`
- [ ] T006 [US1] Adicionar caso "withContext delega mutex: dois contextos enfileiram no mesmo ConsolePrompter" em `tests/io/prompt.test.ts`
- [ ] T007 [US1] Adicionar caso "sem regressão: ask() com pedido único comportamento inalterado" em `tests/io/prompt.test.ts`
- [ ] T008 [US1] Confirmar que os 5 novos testes FALHAM (red)

### Implementação

- [ ] T009 [US1] Adicionar campo `private _lock: Promise<void> = Promise.resolve()` à `ConsolePrompter` em `src/io/prompt.ts`
- [ ] T010 [US1] Adicionar método privado `enqueue<T>(fn: () => Promise<T>): Promise<T>` à `ConsolePrompter` em `src/io/prompt.ts`
- [ ] T011 [US1] Envolver `ask()` com `this.enqueue(...)` em `src/io/prompt.ts`
- [ ] T012 [US1] Envolver `askInt()` com `this.enqueue(...)` em `src/io/prompt.ts`
- [ ] T013 [US1] Envolver `askInts()` com `this.enqueue(...)` em `src/io/prompt.ts`
- [ ] T014 [US1] Envolver `choose()` com `this.enqueue(...)` em `src/io/prompt.ts`
- [ ] T015 [US1] Adicionar método público `withContext(prefix: string): Prompter` à `ConsolePrompter` em `src/io/prompt.ts`

### Integração

- [ ] T016 [US1] Em `src/orcamento/batch-runner.ts`: chamar `prompter.withContext('[${order.provider} / ${order.client.name}]')` por pedido e passar ao `runOrcamento`
- [ ] T017 [US1] Remover comentário sobre serialização serial de `src/orcamento/orchestrator.ts` (mutex resolve automaticamente)

### Validação

- [ ] T018 [US1] Confirmar que T003–T007 PASSAM (green)
- [ ] T019 [US1] Confirmar que `pnpm test` completo passa sem regressões
- [ ] T020 [US1] Confirmar que `pnpm build` compila sem erros

**Story 1 completa ✓** — `feat(prompt): add mutex serialization and withContext to ConsolePrompter`

---

## Phase 4: User Story 2 — Threshold-discount com Escopo por Produto (Priority: P2)

**Goal**: Extender wizard de `threshold-discount` para perguntar escopo (global vs produto específico); ajustar filtro no orchestrator para aplicar só ao produto correto.

**Independent Test**: `pnpm test tests/orcamento/orchestrator.test.ts tests/cli/rules-editor.test.ts` — casos de threshold scope passando.

### Testes (escrever primeiro)

- [ ] T021 [P] [US2] Adicionar caso "threshold global aplica a qualquer produto" em `tests/orcamento/orchestrator.test.ts`
- [ ] T022 [P] [US2] Adicionar caso "threshold específico aplica só ao produto correspondente; outros produtos não recebem desconto da regra" em `tests/orcamento/orchestrator.test.ts`
- [ ] T023 [P] [US2] Adicionar caso "threshold específico tem prioridade sobre global para mesmo produto e mesmo threshold" em `tests/orcamento/orchestrator.test.ts`
- [ ] T024 [P] [US2] Criar `tests/cli/rules-editor.test.ts` com caso "wizard global → repo.save com productCode='*'"
- [ ] T025 [P] [US2] Adicionar caso "wizard específico sem alias existente → aliasRepo.upsert chamado → repo.save com código real" em `tests/cli/rules-editor.test.ts`
- [ ] T026 [P] [US2] Adicionar caso "wizard específico com alias existente → aliasRepo.upsert NÃO chamado" em `tests/cli/rules-editor.test.ts`
- [ ] T027 [US2] Confirmar que os novos testes FALHAM (red)

### Implementação — Orchestrator

- [ ] T028 [US2] Alterar filtro de threshold em `src/orcamento/orchestrator.ts` (~linha 276) adicionando `(r.productCode === '*' || r.productCode === l.productCode)` à condição

### Implementação — Rules Editor

- [ ] T029 [US2] Adicionar parâmetro `aliasRepo: AliasRepository` à assinatura de `addRule` em `src/cli/rules-editor.ts`
- [ ] T030 [US2] Adicionar parâmetro `aliasRepo: AliasRepository` à assinatura de `runRulesEditor` em `src/cli/rules-editor.ts`
- [ ] T031 [US2] No bloco `threshold-discount` de `addRule`, inserir Select de escopo ("Todos os produtos" | "Produto específico") em `src/cli/rules-editor.ts`
- [ ] T032 [US2] Quando escopo "Produto específico": solicitar código + nome; lookup no `aliasRepo`; criar alias se ausente em `src/cli/rules-editor.ts`
- [ ] T033 [US2] Atualizar `repo.save()` no bloco threshold para usar `productCode` variável em `src/cli/rules-editor.ts`
- [ ] T034 [US2] Atualizar label de threshold na listagem para exibir `(global)` ou `(produto <code>)` em `src/cli/rules-editor.ts` (~linha 37)
- [ ] T035 [US2] Atualizar chamada de `runRulesEditor` em `src/cli/index.ts` para passar `aliasRepo`

### Validação

- [ ] T036 [US2] Confirmar que T021–T026 PASSAM (green)
- [ ] T037 [US2] Confirmar que `pnpm test` completo passa sem regressões
- [ ] T038 [US2] Confirmar que `pnpm build` compila sem erros

**Story 2 completa ✓** — `feat(rules): add product-specific scope to threshold-discount wizard`

---

## Phase 5: User Story 3 — Screenshot Automático de Auditoria (Priority: P2)

**Goal**: Capturar screenshot full-page antes de `driver.save()` e salvar co-localizado com o PDF exportado (`<mesmo-nome>.png`).

**Independent Test**: `pnpm test tests/orcamento/orchestrator.test.ts` — casos de screenshot auto passando.

### Testes (escrever primeiro)

- [ ] T039 [US3] Adicionar caso "screenshot capturado antes de driver.save() quando autoScreenshotDir definido" em `tests/orcamento/orchestrator.test.ts`
- [ ] T040 [US3] Adicionar caso "screenshot renomeado para coincidir com nome base do PDF exportado" em `tests/orcamento/orchestrator.test.ts`
- [ ] T041 [US3] Adicionar caso "falha de captureScreenshot: aviso logado, save e export continuam (não-fatal)" em `tests/orcamento/orchestrator.test.ts`
- [ ] T042 [US3] Adicionar caso "dry-run com autoScreenshotDir → captureScreenshot NÃO chamado" em `tests/orcamento/orchestrator.test.ts`
- [ ] T043 [US3] Adicionar caso "screenshotPath explícito tem prioridade sobre autoScreenshotDir" em `tests/orcamento/orchestrator.test.ts`
- [ ] T044 [US3] Confirmar que os novos testes FALHAM (red)

### Implementação — Orchestrator

- [ ] T045 [US3] Adicionar `autoScreenshotDir?: string` ao tipo `RunOrcamentoInput` em `src/orcamento/orchestrator.ts`
- [ ] T046 [US3] Desestruturar `autoScreenshotDir` no início de `runOrcamento` em `src/orcamento/orchestrator.ts`
- [ ] T047 [US3] Adicionar importações `rename` de `node:fs/promises` e `sanitizeFileName` de `../io/export-writer.js` em `src/orcamento/orchestrator.ts`
- [ ] T048 [US3] Implementar determinação de `effectiveScreenshotPath` (explícito > auto-derivado > undefined) antes de `driver.save()` em `src/orcamento/orchestrator.ts`
- [ ] T049 [US3] Implementar captura `driver.captureScreenshot(effectiveScreenshotPath)` antes de `driver.save()` com tratamento não-fatal em `src/orcamento/orchestrator.ts`
- [ ] T050 [US3] Após `exportWriter` retornar `exportPath`: renomear screenshot para `exportPath.replace(/\.pdf$/i, '.png')` quando auto-derivado em `src/orcamento/orchestrator.ts`

### Integração

- [ ] T051 [US3] Em `src/orcamento/batch-runner.ts`: repassar `autoScreenshotDir` para cada `runOrcamento`
- [ ] T052 [US3] Em `src/cli/index.ts`: derivar `autoScreenshotDir` do `baseDir` do export writer e passar ao `runBatch`

### Validação

- [ ] T053 [US3] Confirmar que T039–T043 PASSAM (green)
- [ ] T054 [US3] Confirmar que `pnpm test` completo passa sem regressões
- [ ] T055 [US3] Confirmar que `pnpm build` compila sem erros

**Story 3 completa ✓** — `feat(orchestrator): auto-capture audit screenshot before save`

---

## Phase 6: Polish e Verificação Final

- [ ] T056 [US2] Adicionar caso "inserir regra threshold-discount com mesmo (provider, type, product_code, quantity_value) → ON CONFLICT atualiza sem duplicar" em `tests/cli/rules-editor.test.ts` (cobre FR-012)
- [ ] T057 Rodar `pnpm test` completo final — 100% passing
- [ ] T058 Rodar `pnpm build` — zero erros TypeScript
- [ ] T059 [P] Smoke test manual: orçamento único (não batch) funciona sem regressão
- [ ] T060 [P] Verificar que regras `threshold-discount` globais existentes no DB continuam aplicando corretamente

---

## Dependency Graph

```
T001–T002 (Setup)
     │
     ├── US1: T003–T020  (independente — src/io/prompt.ts + batch-runner.ts)
     ├── US2: T021–T038  (independente — orchestrator.ts filtro + rules-editor.ts)
     └── US3: T039–T055  (independente — orchestrator.ts screenshot + cli/index.ts)
                │
           T056–T059 (Polish — após US1 + US2 + US3)
```

## Parallel Execution

**Desenvolvedor único (recomendado)**: US1 → US2 → US3 → Polish

**Dois desenvolvedores**:
- Dev A: US1 (prompt.ts, batch-runner.ts)
- Dev B: US2 (orchestrator.ts filtro, rules-editor.ts, index.ts)
- Sequencial: US3 (orchestrator.ts screenshot — pode causar conflito com alterações do Dev B)

## MVP Scope

**MVP = US1 (Phase 3)** — resolve o bug crítico de prompts embaralhados em batch paralelo. US2 e US3 são melhorias não-bloqueantes.

## Task Summary

| Fase | Story | Tasks | Paralelas |
|------|-------|-------|-----------|
| 1–2 | Setup | T001–T002 (2) | — |
| 3 | US1 Mutex | T003–T020 (18) | — |
| 4 | US2 Threshold | T021–T038 (18) | T021–T026 [P] |
| 5 | US3 Screenshot | T039–T055 (17) | — |
| 6 | Polish | T056–T059 (4) | T058–T059 [P] |

**Total**: 59 tasks
