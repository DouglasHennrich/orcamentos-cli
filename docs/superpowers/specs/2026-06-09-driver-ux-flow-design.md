# Driver UX Flow Design

## Objetivo

Ajustar os fluxos de automação dos drivers `AutoAmericaDriver` e `RoberloDriver` para evitar travamentos no preenchimento do orçamento, preservando a ordem sensível de campos do portal e validando o caminho completo em modo de simulação (`--dry-run`).

## Problema

Os portais AutoAmerica e Roberlo usam Protheus/APW com jQuery e callbacks legados. Mudanças de valor em selects e campos muitas vezes não disparam os handlers adequados, e o preenchimento prematuro de cabeçalho ou quantidade pode resetar campos críticos.

### Sintomas identificados

- `AutoAmericaDriver.selectPriceTable()` aplica cabeçalho antes de garantir que a lista de produtos foi carregada.
- `AutoAmericaDriver.addLine()` preenche quantidade sem seguir o fluxo de `VldQtd` / `TotalItem`, o que pode travar a validação.
- `RoberloDriver.selectPriceTable()` já dispara a seleção, mas precisa de espera adicional após os setters de cabeçalho para estabilizar o UI.
- O fluxo de simulação precisa ser validado sem salvar o orçamento para confirmar a execução de ponta a ponta.

## Solução proposta

### AutoAmericaDriver

1. `selectPriceTable(code)` deve:
   - setar `#CJ_TABELA` e disparar `.trigger('change')`
   - chamar `selProd()`
   - aguardar `CK_PRODUTO01` carregado
   - aplicar campos de cabeçalho em sequência:
     - `#CJ_TPFRETE`
     - `#CJ_XTRANSP`
     - `#CJ_XTPORC`
   - depois, aplicar:
     - `#CJ_XMODALI = 001`
     - `#CJ_FRETE = 0,00`
     - `recFrete()`
   - então inicializar `#CJ_CONDPAG = 031`
   - aguardar blocos UI concluídos entre cada etapa

2. `addLine(productCode, units)` deve:
   - carregar o produto no número de linha correto
   - chamar `VldQtd(n)`, `TotalItem(n)` e `VldValor(n)` após preencher quantidade
   - aguardar o total do item ser calculado

### RoberloDriver

1. `selectPriceTable(code)` deve manter a lógica existente, mas reforçar a estabilidade:
   - aguardar a lista de produtos carregada
   - aplicar os cabeçalhos de freight apenas após o carregamento
   - aguardar `blockUI` desaparecer após o blur final

2. O restante do fluxo de Roberlo já está alinhado com os requisitos de `CK_XTABELA` por linha e `U_GATPROD.APW`.

### Orquestração e validação

- `runOrcamento()` já possui `dryRun` e não chama `save()` quando ativado.
- A cobertura de teste deve garantir que:
  - em `dryRun`, `save()` e `exportQuote()` não são chamados
  - o resultado da simulação ainda retorna `total` e `parcelas`

## Componentes afetados

- `src/platforms/autoamerica-driver.ts`
- `src/platforms/roberlo-driver.ts`
- `src/orcamento/orchestrator.ts`
- `tests/orcamento/orchestrator.test.ts`

## Critérios de aceitação

- `AutoAmericaDriver.selectPriceTable()` preserva o cabeçalho e pré-configura `CJ_CONDPAG` para evitar resets.
- `AutoAmericaDriver.addLine()` segue o fluxo de validação nativo do portal.
- `RoberloDriver.selectPriceTable()` aguarda estabilidade após aplicar cabeçalho.
- `runOrcamento({ dryRun: true })` simula o orçamentopara um pedido completo, sem chamar `save()` ou `exportQuote()` e retornando `exportPath: '(simulação)'`.

## Testes

- `tests/orcamento/orchestrator.test.ts`
  - adição de caso `dryRun` sem persistência
- validação manual via CLI com `--dry-run` para AutoAmerica e Roberlo
  - `agent-orcamento run -o <pedido>.json --dry-run`

## Riscos e considerações

- A sequência de `recFrete()` e `CJ_CONDPAG` é específica do portal AutoAmerica e pode ter pequenas diferenças entre versões do formulário.
- A simulação não garante que o `save()` funcionará em produção, mas valida o fluxo de preenchimento completo até a etapa de parcelas.
