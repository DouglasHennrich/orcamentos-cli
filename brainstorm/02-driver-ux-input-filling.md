# Brainstorm: Driver UX e Preenchimento de Inputs

**Date:** 2026-06-09
**Status:** active

## Problem Framing

Três problemas independentes mas relacionados ao fluxo de automação dos drivers (AutoAmerica/Roberlo) e à resolução interativa de produtos:

1. **Inputs vazios**: Tabela de Preço, Modalidade e Condição de Pagamento não estão sendo preenchidos corretamente no portal. O `selectClient` usa a abordagem 3 camadas (`.val().trigger('change')` + callback global `SelCliente()` + `waitFor` polling), mas `selectPriceTable` define `#CJ_TABELA` sem `.trigger('change')` e sem verificar se há callback global equivalente. Os campos de Modalidade (`CJ_XTPORC`) e Condição de Pagamento (`CJ_CONDPAG`) têm `.trigger('change')`, mas podem estar sendo resetados pelo `selProd()` ou sofrendo de problemas de timing.

2. **Fluxo de produto não encontrado**: Quando um produto não está no cache de aliases, o fluxo atual faz: busca no portal → exibe resultados com "0) Nenhum / buscar de novo" → usuário seleciona 0 → só então é solicitado novos termos de busca. Dois problemas: (a) a opção "0) Nenhum" é uma etapa de indireção desnecessária; (b) após selecionar um produto descoberto, o sistema pergunta "Outros nomes para este produto?" — essa lógica deve ser removida.

3. **Produtos descobertos não preenchidos no orçamento**: Produtos resolvidos interativamente durante o run (alias salvo no momento da execução) não estão sendo adicionados ao orçamento — somente os produtos já conhecidos são preenchidos. Suspeita: `driver.addLine()` falha silenciosamente para produtos cujo código não estava pré-carregado no dropdown do portal no momento da abertura do orçamento.

## Contexto técnico relevante

Documentado em `docs/automacao-inputs-portais.md`: a abordagem de 3 camadas para inputs APW/Protheus:
- **Camada A**: `.val(value).trigger('change')` via jQuery
- **Camada B**: chamada de callback global do portal (ex: `SelCliente()`, `selProd()`)
- **Camada C**: `waitFor` polling até o DOM confirmar prontidão

O `selectClient` usa as 3 camadas corretamente. O `selectPriceTable` chama `selProd()` mas não faz `.trigger('change')` no `#CJ_TABELA` e não verifica se o portal expõe um callback equivalente ao `SelCliente()` para a tabela.

## Approaches Considered

### Issue 1 — Inputs vazios

#### A: Aplicar 3 camadas completas ao CJ_TABELA + investigar callbacks ⭐ Recomendado
- Adicionar `.trigger('change')` ao `#CJ_TABELA` antes de chamar `selProd()`
- Investigar se o portal expõe função global análoga a `SelCliente()` para tabela (ex: `SelTabela()`)
- Mover o preenchimento de Modalidade/Frete para APÓS o `waitFor` de produtos carregados (evitar reset pelo `selProd()`)
- Pros: Segue o padrão documentado; o `waitFor` garante que o portal processou antes de seguir
- Cons: Requer inspeção do JS do portal para identificar callbacks

#### B: Adicionar delays fixos entre os passos
- Pros: Simples de implementar
- Cons: Frágil, viola a estratégia do projeto (anti-padrão documentado)

### Issue 2 — Fluxo produto não encontrado

#### A: Remover "0) Nenhum", loop de re-busca direto ⭐ Recomendado
- `choose()` exibe apenas as opções numeradas (sem "0) Nenhum")
- Se usuário digita `0` ou valor inválido → re-pergunta diretamente "Digite termos de busca:" sem etapa intermediária
- Remover a pergunta "Outros nomes para este produto?" de `resolver.ts` inteiramente
- Pros: UX mais fluida; menos steps para o usuário; salva alias apenas com o nome original do pedido
- Cons: Aliases extras não são coletados (considerado desnecessário pelo usuário)

#### B: Manter "0) Nenhum", apenas remover aliases extras
- Pros: Menor mudança de código
- Cons: Não resolve o problema principal de UX (seleção de 0 ainda necessária)

### Issue 3 — Produtos descobertos não preenchidos

#### A: Adicionar logging + investigar driver.addLine para produtos "descobertos" ⭐ Recomendado
- Logar distinção entre produtos "do cache" vs "descobertos interativamente" antes da fase de `addLine`
- Verificar se o código do produto retornado pelo `searchProducts` coincide com um valor válido no dropdown do portal (produtos não pré-carregados podem falhar silenciosamente)
- Se confirmado: garantir que o portal re-carregue o dropdown ou que `addLine` force a seleção mesmo para produtos fora do dropdown pré-carregado
- Pros: Diagnostica a causa raiz antes de implementar fix; logging ajuda a confirmar o bug
- Cons: Pode exigir mudanças no driver de baixo nível (interação com dropdown do portal)

#### B: Re-executar `searchProducts` + `selProd()` para produtos descobertos antes do `addLine`
- Pros: Garante que o produto está no dropdown antes de tentar adicioná-lo
- Cons: Pode ser lento; pode resetar estado do formulário

## Decision

**Issue 1**: Abordagem A — Aplicar `.trigger('change')` ao `#CJ_TABELA` + investigar callback global do portal para tabela. Mover setters de Modalidade/Frete/Transportadora para depois do `waitFor` de produtos para evitar reset.

**Issue 2**: Abordagem A — Remover "0) Nenhum" do display. Loop de re-busca direto quando input inválido. Remover pergunta de aliases extras de `resolver.ts`.

**Issue 3**: Abordagem A — Implementar logging para distinguir produtos conhecidos vs descobertos, confirmar se `addLine` falha para produtos não pré-carregados, depois implementar fix no driver.

## Key Requirements

### Driver — Inputs
- `selectPriceTable` deve chamar `.trigger('change')` no `#CJ_TABELA` antes de `selProd()`
- Investigar se existe callback global do portal para tabela de preço (inspecionar JS do portal)
- Os setters de Modalidade (`CJ_XTPORC`), Frete (`CJ_TPFRETE`) e Transportadora (`CJ_XTRANSP`) devem ser aplicados APÓS o `waitFor` de produtos carregados, não antes
- Aplicar mesma análise ao `roberlo-driver.ts`

### Resolver — UX produto não encontrado
- `prompter.choose()` não exibe mais "0) Nenhum / buscar de novo" como opção explícita
- Quando usuário digita `0` ou entrada inválida em `choose()`, retorna `null` → `resolver.ts` solicita diretamente novos termos de busca
- Remover bloco de "Outros nomes para este produto" de `resolver.ts` (linhas 71–77)
- Ao salvar alias, usar apenas `[line.name]` como alias (sem extras)

### Resolver — Produtos descobertos
- Adicionar log antes de `driver.addLine()` para cada linha: indicar se o produto veio do cache ou foi descoberto interativamente
- Investigar e corrigir caso em que `addLine` falha silenciosamente para produtos não pré-carregados no dropdown do portal

## Open Questions

- O portal AutoAmerica expõe alguma função global (`SelTabela()`?) análoga ao `SelCliente()` para seleção de tabela de preço? (requer inspeção do JS do portal em execução)
- O bug dos produtos descobertos se manifesta em ambos os drivers (AutoAmerica e Roberlo) ou apenas em um deles?
- Ao remover os aliases extras do resolver, aliases coletados pelo usuário em runs anteriores serão mantidos? (sim — só param de ser coletados novos, os existentes no DB permanecem)
