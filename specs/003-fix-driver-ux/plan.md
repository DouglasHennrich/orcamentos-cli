# Implementation Plan: Driver UX e Preenchimento de Inputs

**Branch**: `003-fix-driver-ux` | **Date**: 2026-06-09 | **Spec**: [spec.md](spec.md)

## Summary

Três correções de bugs no fluxo de automação de orçamentos:

1. **Inputs vazios** (`autoamerica-driver.ts`): adicionar `.trigger('change')` ao `#CJ_TABELA` e mover setters de Modalidade/Frete para após o carregamento de produtos.
2. **Fluxo produto não encontrado** (`prompt.ts`, `resolver.ts`): remover opção "0) Nenhum" do `choose()` e remover coleta de aliases extras.
3. **Produtos descobertos omitidos** (`orchestrator.ts`): tratar retorno de `driver.addLine()` e adicionar logging.

A pesquisa revelou que Issue 1 e Issue 3 têm causa raiz compartilhada: `CJ_TABELA` sem trigger → `addLine` usa tabela vazia → `U_GATPROD.APW` falha → produto silenciosamente omitido.

## Technical Context

- **Runtime**: TypeScript, Node.js, Playwright (browser automation)
- **Arquivos afetados**: `autoamerica-driver.ts`, `roberlo-driver.ts`, `prompt.ts`, `resolver.ts`, `orchestrator.ts`
- **Testes existentes**: `tests/resolver.test.ts`, `tests/orchestrator.test.ts`, `tests/prompt.test.ts` (se existirem)
- **Sem novas dependências**: todas as mudanças são em código existente

## Implementation Plan

### Fix 1A — autoamerica-driver.ts: trigger em CJ_TABELA

**File**: `src/platforms/autoamerica-driver.ts`
**Method**: `selectPriceTable()`

Trocar:
```
jQuery('#CJ_TABELA').val(code);
selProd();
```
Por:
```
jQuery('#CJ_TABELA').val(code).trigger('change');
selProd();
```

### Fix 1B — autoamerica-driver.ts: mover setters de Modalidade/Frete

**File**: `src/platforms/autoamerica-driver.ts`
**Method**: `selectPriceTable()`

O bloco `if (this.startOpts)` que seta `CJ_XTPORC`, `CJ_TPFRETE`, `CJ_XTRANSP` está ANTES do `waitFor`. Mover esse bloco para APÓS o `waitFor` (e após o `if (!produtosLoaded) return error`).

Estrutura final:
```
1. jQuery('#CJ_TABELA').val(code).trigger('change')  ← Fix 1A
2. selProd()
3. waitFor('CK_PRODUTO01 options > 1', 10000)
4. if (!produtosLoaded) return error
5. if (this.startOpts) { set CJ_XTPORC, CJ_TPFRETE, CJ_XTRANSP }  ← movido aqui
6. return success
```

### Fix 1C — roberlo-driver.ts: mover setters de Modalidade/Frete

**File**: `src/platforms/roberlo-driver.ts`
**Method**: `selectPriceTable()`

O trigger no `#CK_XTABELA01` já existe (correto). No entanto, os setters de Modalidade/Frete (linhas 167-172) estão ANTES do `setTimeout` de 500ms. Mover esses setters para APÓS o `setTimeout`/wait para consistência. Substituir o `setTimeout` fixo por `waitFor` se possível, ou mantê-lo e aplicar os setters depois.

### Fix 2A — prompt.ts: remover "0) Nenhum"

**File**: `src/io/prompt.ts`
**Method**: `ConsolePrompter.choose()`

Remover `\n0) Nenhum / buscar de novo` da string de output em `choose()`. Manter o retorno `null` quando `n === 0` ou entrada inválida — esse comportamento não muda, apenas o texto exibido.

### Fix 2B — resolver.ts: remover aliases extras

**File**: `src/orcamento/resolver.ts`
**Method**: `resolveLine()`

Remover o bloco de coleta de extras (perguntar "Outros nomes...") e simplificar `repo.save()` para usar apenas `aliases: [line.name]`.

### Fix 3 — orchestrator.ts: tratar retorno de addLine + logging

**File**: `src/orcamento/orchestrator.ts`
**Method**: `runOrcamento()`

Na seção "Add all lines in units":
- Verificar o retorno de `driver.addLine()` (`result.status === 'error'`)
- Logar cada produto antes de `addLine`, indicando se veio do cache ou foi descoberto interativamente
- Acumular falhas em array e exibir contagem de avisos no final do run
- Produtos que falharam em `addLine` não entram no `boxes` map (não tentar aplicar descontos em produto não adicionado)

**Adição ao tipo `ResolvedLine`** (`src/orcamento/resolver.ts`):
```typescript
resolvedFrom: 'cache' | 'interactive';
```
- `resolveLine` via cache/fuzzy → `resolvedFrom: 'cache'`
- `resolveLine` via seleção interativa → `resolvedFrom: 'interactive'`

## Data Model Changes

Nenhuma mudança no banco de dados SQLite.

**Tipo `ResolvedLine`** — adição de campo informativo:
- `resolvedFrom: 'cache' | 'interactive'` — usado apenas para logging no orchestrator

## Test Plan

### Testes a atualizar

1. `tests/resolver.test.ts`: verificar que `resolveLine` não chama `prompter.ask` para aliases extras após seleção interativa; verificar `resolvedFrom` correto em cada caso.
2. `tests/prompt.test.ts` (ou equivalente): verificar que `choose()` não exibe "0) Nenhum" no output.
3. `tests/orchestrator.test.ts`: adicionar caso onde `driver.addLine` retorna `error` — verificar que outros produtos ainda são processados e que aviso aparece.

### Regressões a garantir

- `choose()` com input `0` retorna `null` (comportamento mantido)
- Loop de re-busca em `resolver.ts` continua funcionando quando `choose()` retorna `null`
- Produtos com `addLine` bem-sucedido continuam com desconto aplicado normalmente
