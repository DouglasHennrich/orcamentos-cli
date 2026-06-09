# Tasks: Driver UX e Preenchimento de Inputs

**Input**: Design documents from `/specs/003-fix-driver-ux/`

**Branch**: `003-fix-driver-ux`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Adição do campo `resolvedFrom` ao tipo `ResolvedLine` — necessário para logging no orchestrator (US3).

**⚠️ CRÍTICO**: US3 depende dessa mudança de tipo.

- [X] T001 Add field `resolvedFrom: 'cache' | 'interactive'` to `ResolvedLine` interface in `src/orcamento/resolver.ts`
- [X] T002 Set `resolvedFrom: 'cache'` in `build()` function return in `src/orcamento/resolver.ts`
- [X] T003 Set `resolvedFrom: 'interactive'` in interactive selection return path in `src/orcamento/resolver.ts`

**Checkpoint**: Tipo `ResolvedLine` atualizado — TypeScript compila sem erros

---

## Phase 2: User Story 1 — Inputs preenchidos corretamente (Priority: P1) 🎯 MVP

**Goal**: `selectPriceTable` dispara evento correto no portal; Modalidade/Frete/Transportadora são setados após carregamento de produtos.

**Independent Test**: Executar orçamento completo e verificar no portal que Tabela de Preço, Modalidade e Transportadora aparecem preenchidos antes do salvamento.

- [X] T004 [US1] Fix `selectPriceTable()` in `src/platforms/autoamerica-driver.ts`: add `.trigger('change')` to `jQuery('#CJ_TABELA').val(code)` call before `selProd()`
- [X] T005 [US1] Move `if (this.startOpts)` block (setters for `CJ_XTPORC`, `CJ_TPFRETE`, `CJ_XTRANSP`) to AFTER the `waitFor` + error check in `src/platforms/autoamerica-driver.ts`
- [X] T006 [P] [US1] Verify `selectPriceTable()` in `src/platforms/roberlo-driver.ts`: confirm `.trigger('change')` is present on table field; move Modalidade/Frete setters to after the wait if they precede it

**Checkpoint**: AutoAmerica dispara trigger em `#CJ_TABELA`; setters de Modalidade/Frete executam somente após carregamento de produtos em ambos os drivers

---

## Phase 3: User Story 3 — Produtos descobertos adicionados ao orçamento (Priority: P1)

**Goal**: `driver.addLine()` retorno verificado; produtos com erro logados; contagem de falhas no resumo do run.

**Independent Test**: Executar orçamento com produto resolvido interativamente; verificar que aparece no orçamento E que erros de `addLine` são logados.

**Nota**: Depende de Phase 2 (T004) — o trigger em `CJ_TABELA` é a causa raiz do `U_GATPROD.APW` falhar.

- [X] T007 [US3] In `src/orcamento/orchestrator.ts`, update "Add all lines" loop: check `result.status`, log each product with `resolvedFrom` origin, accumulate failures in `addLineFailures: string[]`
- [X] T008 [US3] In `src/orcamento/orchestrator.ts`, add failure count warning to final run output after the minimum-value loop
- [X] T009 [US3] In `src/orcamento/orchestrator.ts`, exclude failed products from `boxes` map so discount logic is not applied to non-added products

**Checkpoint**: Produto com `addLine` falhando é logado com nome/código; outros produtos adicionados normalmente; resumo final exibe contagem de falhas

---

## Phase 4: User Story 2 — Fluxo produto não encontrado sem fricção (Priority: P2)

**Goal**: `choose()` não exibe "0) Nenhum"; loop de re-busca direto; aliases extras não são coletados.

**Independent Test**: Executar orçamento com produto não cadastrado; verificar que (a) "0) Nenhum" não aparece na lista, (b) digitar `0` solicita novos termos diretamente, (c) após selecionar produto não pergunta aliases.

- [X] T010 [P] [US2] Fix `ConsolePrompter.choose()` in `src/io/prompt.ts`: remove `\n0) Nenhum / buscar de novo` from output string; keep `n === 0` returning `null`
- [X] T011 [P] [US2] Fix `resolveLine()` in `src/orcamento/resolver.ts`: remove lines 71–77 (extraRaw/extras collection); update `repo.save()` call to use `aliases: [line.name]` only

**Checkpoint**: `choose()` não exibe opção "0) Nenhum"; alias salvo apenas com nome original do pedido

---

## Phase 5: Testes

**Purpose**: Atualizar testes existentes para refletir as mudanças de comportamento.

- [X] T012 [P] Update resolver tests in `tests/resolver.test.ts`: assert no `prompter.ask` call for extra aliases after interactive selection; assert `resolvedFrom` is `'cache'` for cache hits and `'interactive'` for interactive selections
- [X] T013 [P] Update prompt tests (if they exist): assert `choose()` output does NOT contain "Nenhum / buscar de novo"
- [X] T014 Update orchestrator tests in `tests/orchestrator.test.ts`: add test where `driver.addLine` returns `{ status: 'error' }` — assert remaining products are processed, warning logged, failed product excluded from `boxes` map
- [X] T015 Run full test suite: `npm test` from repo root — verify all existing tests pass

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies — start here
- **Phase 2**: Depends on Phase 1 (`resolvedFrom` field in type)
- **Phase 3**: Depends on Phase 1 and Phase 2 (CJ_TABELA fix is root cause)
- **Phase 4**: Depends on Phase 1 only — can run in parallel with Phase 2 (different files)
- **Phase 5**: Depends on all prior phases

### Parallel Opportunities

- T010, T011 (Phase 4) can run in parallel with Phase 2 tasks (`prompt.ts`, `resolver.ts` vs `autoamerica-driver.ts`)
- T006 (roberlo-driver.ts) can run in parallel with T004/T005 (autoamerica-driver.ts)
- T012, T013 can run in parallel within Phase 5

### Sequência recomendada (single developer)

```
T001-T003 → T004-T005 → T006,T010,T011 (paralelo) → T007-T009 → T012-T015
```
