# Brainstorm Overview

Last updated: 2026-06-09

## Sessions

| # | Date | Topic | Status | Spec | Issue |
|---|------|-------|--------|------|-------|
| 01 | 2026-06-08 | batch-paralelo-e-regras-de-produtos | active | - | - |
| 02 | 2026-06-09 | driver-ux-input-filling | active | - | - |
| 03 | 2026-06-09 | prompt-concorrencia-threshold-scope-screenshot | active | - | - |

## Open Threads

- O editor interativo de regras deve usar `ConsolePrompter` existente ou `inquirer`? (from #01)
- Quando múltiplos orçamentos em paralelo usam o mesmo browser agent, há limitação de concorrência? (from #01)
- Regras `add-product` devem participar do loop de valor mínimo (bump) ou apenas adicionadas como estão? (from #01)
- Tiers de threshold devem ser exibidos agrupados no log de início do run (from #01 revisita 2026-06-09)
- O campo `quantity_unit` para `threshold-discount` é armazenado como `NULL` (from #01 revisita 2026-06-09)
- Portal AutoAmerica expõe `SelTabela()` ou callback global análogo ao `SelCliente()` para tabela de preço? (from #02)
- Bug de produtos descobertos se manifesta nos dois drivers ou só em um? (from #02)
- O mutex do `ConsolePrompter` deve ser implementado com `async-mutex` ou artesanalmente com Promise chain? (from #03)
- Quando threshold-discount tem `product_code` real e o produto não está no orçamento, a regra é ignorada silenciosamente ou gera aviso? (from #03)
- Screenshot automático deve funcionar no dry-run também ou apenas no run real? (from #03)

## Parked Ideas

_(nenhuma)_
