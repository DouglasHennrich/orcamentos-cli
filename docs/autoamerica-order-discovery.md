# AutoAmerica Order Discovery - Passo a Passo

Este documento descreve o fluxo mínimo de discovery para criar um orçamento no portal AutoAmerica e os pontos críticos identificados até agora.

## Objetivo

Seguir um roteiro repetível para:
- logar no portal AutoAmerica
- iniciar um novo orçamento
- selecionar cliente e tabela
- preencher cabeçalho na ordem correta
- adicionar itens de pedido com a validação de quantidade correta
- manter a estabilidade de `Modalidade` e `Condição de Pagamento`

## Passo a passo

1. **Login no portal**
   - Acesse `https://representante.autoamerica.com.br:5100/portal/U_PortalLogin.apw`
   - Preencha `login` e `password`
   - Clique em `Acessar`
   - Verifique que o menu do portal aparece e que há o link `Orçamento de Venda`

2. **Ir para Orçamento de Venda**
   - Clique no link `Orçamento de Venda`
   - Se o click falhar, use o href direto com `agent-browser open` em `U_orcamento.apw`

3. **Iniciar novo orçamento**
   - Clique em `Novo Orçamento`
   - Confirme o modal `Filial Para Orçamento` clicando em `OK`
   - Verifique que a tela de `Orçamento de Venda` está aberta

4. **Selecionar cliente**
   - Ajuste `CJ_CLIENTE` para o valor do cliente desejado
   - Para o pedido atual, usar `0072831170001` → `OLIVEIRA E OLIVEIRA COMERCIO DE TINTAS LTDA`
   - Execute `SelCliente()` após definir o valor de `#CJ_CLIENTE`
   - Aguarde o carregamento do combo `CJ_TABELA`

5. **Selecionar tabela de preço**
   - Ajuste `CJ_TABELA` para `099`
   - Execute `selProd()` após definir o valor de `#CJ_TABELA`
   - Aguarde o carregamento de `CK_PRODUTO01`

6. **Preencher cabeçalho na ordem correta**
   - `CJ_TPFRETE` = `C` (`CIF`)
   - `CJ_XTRANSP` = `000157` (`EXPRESSO SAO MIGUEL LTDA`)
   - `CJ_XTPORC` = `3` (`Em elaboração`)
   - Depois:
     - `CJ_XMODALI` = `001` (`BOLETO BANCARIO`)
     - `CJ_FRETE` = `0,00`
     - chamar `recFrete()`
     - `CJ_CONDPAG` = `031` (`30/60`)
   - Use `focus().blur()` entre cada campo e aguarde a UI ficar livre

7. **Adicionar o produto**
   - Pesquise o produto no select `CK_PRODUTO01`
   - Selecione o value correto pelo texto
   - Exemplo inicial: `304535001 - SUPER POLIDOR AUTOAMERICA 1KG`

8. **Preencher quantidade corretamente**
   - O campo `CK_QTDVEN01` não pode ser preenchido livremente; precisa passar por `VldQtd('01')`
   - Verifique `QTD_EMB01` para saber o múltiplo obrigatório
   - Para o produto atual, use uma quantidade compatível com `QTD_EMB01`
   - Exemplo que funcionou: `12` quando `QTD_EMB01` = `6`
   - Método usado para popular o campo:
     1. focus() no `CK_QTDVEN01`
     2. atribuir `q.value = '12'`
     3. disparar `input` e teclas (`keydown`/`keyup`)
     4. chamar `VldQtd('01')`
     5. chamar `TotalItem('01')`
     6. blur() no campo
   - Não tente resetar `CK_QTDVEN01` por `.val()` isoladamente sem disparar a validação

9. **Inserir desconto**
   - O campo `CK_DESCONT01` aceita valor em formato porcentagem
   - Método usado:
     1. focus() no `CK_DESCONT01`
     2. atribuir `el.value = '15,00%'`
     3. disparar `input` e teclas (`keydown`/`keyup`)
     4. chamar `VldValor('01')`
     5. blur() no campo
   - Verifique que o campo apresenta `15,00%` após validação, não `00,15%`

10. **Verificar cabeçalho após item**
   - Depois de adicionar o produto e a quantidade válida, confirme:
     - `CJ_XMODALI` ainda é `BOLETO BANCARIO`
     - `CJ_CONDPAG` ainda é `031 - 30/60`
   - Confirme que `CK_DESCONT01` não está bloqueado e que o total foi calculado

10. **Repetir para as próximas linhas**
    - Quando precisar de mais itens, clique em `Novo Item`
    - Replique o mesmo fluxo de seleção de produto, quantidade e validação
    - Observe se qualquer novo item reseta o cabeçalho ou abre modal de alerta

## Métodos e callbacks utilizados

- `SelCliente()` — executar após definir `#CJ_CLIENTE`
- `selProd()` — executar após definir `#CJ_TABELA`
- `gatProduto($(this))` — chamado pelo `onchange` de `CK_PRODUTO01` ao selecionar um produto; também acionado manualmente em `CK_PRODUTO02` e `CK_PRODUTO03`
- `recFrete()` — chamar após preencher `CJ_FRETE`
- `VldQtd('01')`, `VldQtd('02')`, `VldQtd('03')` — validar quantidade do item nos campos `CK_QTDVENxx`
- `TotalItem('01')`, `TotalItem('02')`, `TotalItem('03')` — recalcular totais após validação de quantidade
- `VldValor('01')`, `VldValor('03')` — validar e aplicar desconto no item
- `focus()` / `blur()` — usar entre alterações para disparar o processamento nativo do portal
- `element.dispatchEvent(new Event('input',{bubbles:true}))` — disparar mudança de campo quando o portal depende de eventos JS
- `element.dispatchEvent(new KeyboardEvent('keydown',{key:...}))` / `KeyboardEvent('keyup',{key:...})` — simular digitação para campos que usam mask/keyup
- `jQuery('#field').val(value).trigger('change')` — método principal para preencher selects e campos do portal
- `jQuery('#CK_PRODUTO02').trigger('change')` e `jQuery('#CK_PRODUTO03').trigger('change')` — atualizar produto nas linhas 2 e 3

## Anotações importantes

- O portal AutoAmerica pode deslogar entre tentativas. Se perder a sessão, recomece pelo login.
- O bug mais crítico identificado é o preenchimento incorreto da quantidade de produto, que trava o campo de desconto.
- A ordem de preenchimento do cabeçalho é sensível; `Modalidade` e `Condição de Pagamento` só se mantêm estáveis depois de `recFrete()` e do fluxo sequencial.
- Use logs em `./tmp/` para rastrear cada comando `agent-browser` executado.

## Checklist de validação

- [ ] Login bem sucedido
- [ ] Orçamento de Venda aberto
- [ ] Cliente selecionado com `SelCliente()`
- [ ] Tabela selecionada com `selProd()`
- [ ] Cabeçalho preenchido em sequência
- [ ] Produto selecionado em `CK_PRODUTO01`
- [ ] Quantidade preenchida com múltiplo válido
- [ ] `Modalidade` e `Condição de Pagamento` preservados
- [ ] Sem modais ou bloqueios ativos
