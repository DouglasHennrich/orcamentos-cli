# Research: Driver UX e Preenchimento de Inputs

**Date**: 2026-06-09
**Branch**: 003-fix-driver-ux

## Issue 1 — selectPriceTable: falta de `.trigger('change')`

**Finding**: `autoamerica-driver.ts:164` faz `jQuery('#CJ_TABELA').val(code)` sem `.trigger('change')`. O `selectClient` (`autoamerica-driver.ts:124`) usa `.val().trigger('change')` + `SelCliente()` + `waitFor`. A ausência do trigger impede que o portal processe o valor corretamente.

**Root cause**: A chamada a `selProd()` (linha 165) pressupõe que o portal já reconheceu o valor de `CJ_TABELA`, mas como o evento `change` não foi disparado, o portal pode não ter propagado a seleção internamente antes da chamada.

**Decision**: Adicionar `.trigger('change')` ao `#CJ_TABELA` logo após `.val(code)` e antes de `selProd()`.

**Roberlo status**: `roberlo-driver.ts:162` já usa `.val(code).trigger('change')` em `selectPriceTable` — nenhuma mudança necessária (FR-003 confirmado como verificação apenas).

**Efeito colateral descoberto**: `addLine` em `autoamerica-driver.ts:338` passa `tabela: jQuery('#CJ_TABELA').val() || ''` no corpo AJAX de `U_GATPROD.APW`. Se `CJ_TABELA` não estiver corretamente setado, o AJAX retorna erro ou preço 0, fazendo com que `addLine` falhe com `status: 'error'`. Este é o elo que conecta Issue 1 e Issue 3.

## Issue 1 — Setters de Modalidade/Frete/Transportadora

**Finding**: Em `autoamerica-driver.ts:169-175`, os setters de Modalidade, Frete e Transportadora são executados ANTES do `waitFor` que aguarda o carregamento dos produtos. O `selProd()` pode resetar esses campos durante seu processamento AJAX.

**Decision**: Mover os setters de `CJ_XTPORC`, `CJ_TPFRETE`, `CJ_XTRANSP` para APÓS o `waitFor` de produtos.

**Roberlo status**: Mesma estrutura (`roberlo-driver.ts:166-172`) — mesmo problema, mesma correção.

## Issue 2 — Fluxo produto não encontrado

**Finding**: `ConsolePrompter.choose()` (`src/io/prompt.ts:77`) exibe `"0) Nenhum / buscar de novo"`. `resolver.ts:87` solicita novos termos apenas quando `choose()` retorna `null` (usuário digitou 0). Linhas 71-77 de `resolver.ts` coletam aliases extras após seleção.

**Decision**:
- Remover a linha `"0) Nenhum / buscar de novo"` do método `choose()` em `prompt.ts`.
- Comportamento quando `n === 0` ou inválido já retorna `null` — manter esse caminho, apenas remover o texto da opção.
- Remover linhas 71-77 de `resolver.ts` (coleta de aliases extras). `repo.save` usa apenas `[line.name]`.

## Issue 3 — Produtos descobertos não preenchidos

**Root cause confirmado**: `orchestrator.ts:146` ignora o valor de retorno de `driver.addLine()`. Se `addLine` retorna `{ status: 'error' }` (o que ocorre quando `U_GATPROD.APW` falha porque `CJ_TABELA` está vazio — consequência de Issue 1), o produto é silenciosamente omitido do orçamento.

**Cadeia causal completa**:
1. Issue 1 → `CJ_TABELA` não recebe evento `change` → portal não atualiza valor internamente
2. `addLine` passa `jQuery('#CJ_TABELA').val() || ''` → tabela vazia → `U_GATPROD.APW` retorna erro
3. `addLine` decrementa `itemCount` e retorna `status: 'error'`
4. Orchestrator ignora o retorno → produto omitido silenciosamente

**Decision**:
- Verificar e tratar o retorno de `driver.addLine()` no orchestrator.
- Logar antes de cada `addLine`: identificar se produto veio do cache ou foi descoberto interativamente.
- Adicionar contagem de falhas de `addLine` no resumo final do run.

## Arquivos afetados

| Arquivo | Issues |
|---------|--------|
| `src/platforms/autoamerica-driver.ts` | 1, 3 |
| `src/platforms/roberlo-driver.ts` | 1 (verificação) |
| `src/io/prompt.ts` | 2 |
| `src/orcamento/resolver.ts` | 2 |
| `src/orcamento/orchestrator.ts` | 3 |
| `tests/` | 1, 2, 3 (atualização de testes existentes) |
