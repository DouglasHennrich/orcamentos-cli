# Feature Specification: Driver UX e Preenchimento de Inputs

**Feature Branch**: `003-fix-driver-ux`

**Created**: 2026-06-09

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Tabela de Preço, Modalidade e Transportadora preenchidos corretamente (Priority: P1)

O operador executa um orçamento. Após selecionar o cliente, o sistema seleciona a tabela de preço aplicando o evento correto para que o portal reaja (AJAX). Os campos Modalidade, Tipo de Frete e Transportadora são preenchidos somente após o portal terminar de carregar os produtos, evitando que sejam resetados.

**Why this priority**: Inputs vazios fazem o orçamento ser salvo com dados incorretos ou incompletos no portal APW/Protheus — bloqueante para o fluxo principal.

**Independent Test**: Pode ser testado executando um orçamento completo e verificando no portal que Tabela de Preço, Modalidade e Transportadora aparecem preenchidos no formulário antes do salvamento.

**Acceptance Scenarios**:

1. **Given** um cliente válido foi selecionado, **When** a tabela de preço é definida, **Then** o portal dispara a atualização AJAX de produtos e a tabela aparece preenchida no formulário.
2. **Given** a tabela de preço foi selecionada e os produtos carregaram, **When** o sistema define Modalidade e Transportadora, **Then** esses campos aparecem preenchidos no formulário final, sem serem resetados pelo carregamento de produtos.
3. **Given** o portal não carregou os produtos dentro do timeout, **When** o sistema detecta o timeout, **Then** retorna erro descritivo sem deixar o formulário em estado parcial.

---

### User Story 2 — Fluxo de resolução de produto não encontrado sem fricção desnecessária (Priority: P2)

O operador executa um orçamento com um produto cujo nome não está no banco de aliases. O sistema busca o produto no portal e exibe os resultados numerados. O operador escolhe um resultado ou digita `0` para refinar a busca — sem precisar selecionar uma opção intermediária de "buscar de novo". Após escolher o produto, o sistema salva o alias e segue — sem perguntar sobre nomes adicionais.

**Why this priority**: A etapa intermediária "0) Nenhum / buscar de novo" adiciona fricção sem valor: o usuário já sabe que quer buscar de novo quando não vê o produto na lista.

**Independent Test**: Pode ser testado executando um orçamento com um produto não cadastrado e verificando que: (a) a lista não tem opção "0) Nenhum", (b) digitar `0` pede novos termos diretamente, (c) após selecionar, não pergunta aliases extras.

**Acceptance Scenarios**:

1. **Given** produto não está no banco de aliases, **When** o sistema busca no portal e retorna resultados, **Then** exibe lista numerada sem a opção "0) Nenhum / buscar de novo".
2. **Given** a lista de resultados está exibida, **When** o operador digita `0` ou um número inválido, **Then** o sistema solicita diretamente novos termos de busca, sem etapa intermediária.
3. **Given** a lista de resultados está exibida, **When** o operador escolhe um número válido, **Then** o sistema salva o alias (apenas com o nome original do pedido) e continua sem perguntar por nomes adicionais.
4. **Given** a busca no portal retorna zero resultados, **When** o sistema exibe a mensagem de sem resultados, **Then** solicita novos termos de busca diretamente.

---

### User Story 3 — Produtos descobertos interativamente são adicionados ao orçamento (Priority: P1)

O operador executa um orçamento e resolve interativamente um produto não encontrado (escolhe da lista do portal e salva o alias). Após a resolução, esse produto aparece no orçamento junto com os produtos já conhecidos.

**Why this priority**: Sem essa correção, produtos descobertos durante o run são ignorados silenciosamente no preenchimento do orçamento — perda de dados crítica.

**Independent Test**: Pode ser testado executando um orçamento com pelo menos um produto não cadastrado, resolvendo interativamente, e verificando que o produto aparece preenchido no formulário do portal junto com os demais.

**Acceptance Scenarios**:

1. **Given** um produto foi resolvido interativamente durante o run, **When** o sistema preenche os produtos no portal, **Then** o produto descoberto aparece na lista de produtos do orçamento.
2. **Given** um mix de produtos conhecidos e descobertos, **When** o sistema preenche o orçamento, **Then** todos os produtos (conhecidos e descobertos) são preenchidos, sem omissões silenciosas.
3. **Given** `addLine` falha para um produto descoberto, **When** o sistema detecta a falha, **Then** registra no log qual produto falhou e por qual razão, em vez de ignorar silenciosamente.

---

### Edge Cases

- O que acontece se o portal não tiver tabelas de preço disponíveis para o cliente? → Retornar erro descritivo (comportamento existente mantido).
- O que acontece se a busca de produto retornar resultados mas nenhum for o correto após várias tentativas? → Loop continua até o operador escolher um resultado válido (comportamento existente mantido).
- O que acontece se `addLine` falhar para um produto descoberto? → Logar o erro com identificação do produto e prosseguir sem interromper silenciosamente os demais produtos.
- O que acontece se o portal não tiver callback global para tabela de preço? → Apenas `.trigger('change')` é suficiente; ausência de callback global não deve causar erro.

## Requirements *(mandatory)*

### Functional Requirements

**Issue 1 — Preenchimento de inputs**

- **FR-001**: O sistema DEVE chamar `.trigger('change')` no campo `#CJ_TABELA` ao selecionar a tabela de preço, antes de chamar `selProd()`.
- **FR-002**: O sistema DEVE aplicar os campos Modalidade (`CJ_XTPORC`), Tipo de Frete (`CJ_TPFRETE`) e Transportadora (`CJ_XTRANSP`) somente após o `waitFor` confirmar que os produtos foram carregados no portal.
- **FR-003**: O mesmo comportamento dos itens FR-001 e FR-002 DEVE ser verificado e aplicado ao driver do Roberlo onde aplicável.

**Issue 2 — Fluxo produto não encontrado**

- **FR-004**: O método `choose()` do `ConsolePrompter` NÃO DEVE exibir a opção "0) Nenhum / buscar de novo" na lista de opções.
- **FR-005**: Quando o operador digitar `0` ou um valor inválido em `choose()`, o método DEVE retornar `null` e o `resolver.ts` DEVE solicitar diretamente novos termos de busca.
- **FR-006**: O bloco que pergunta "Outros nomes para este produto" DEVE ser removido de `resolver.ts`. O alias DEVE ser salvo usando apenas `[line.name]` como identificador.

**Issue 3 — Produtos descobertos**

- **FR-007**: O `orchestrator.ts` DEVE registrar no log, antes de cada chamada a `driver.addLine()`, se o produto veio do cache de aliases ou foi descoberto interativamente no run atual.
- **FR-008**: O sistema DEVE garantir que produtos resolvidos interativamente sejam incluídos no preenchimento do orçamento no portal, da mesma forma que produtos já conhecidos.
- **FR-009**: Falhas em `driver.addLine()` para produtos descobertos DEVEM ser registradas no log com identificação do produto (código e nome), sem interromper silenciosamente o preenchimento dos demais produtos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após executar um orçamento completo, os campos Tabela de Preço, Modalidade e Transportadora aparecem preenchidos no formulário do portal antes do salvamento em 100% das execuções válidas.
- **SC-002**: O fluxo de resolução de produto não encontrado requer no mínimo uma interação a menos do que o fluxo anterior (remoção da seleção "0) Nenhum").
- **SC-003**: Produtos resolvidos interativamente durante o run aparecem no orçamento preenchido no portal com a mesma taxa de sucesso dos produtos já conhecidos.
- **SC-004**: Quando `addLine` falha para qualquer produto, o log contém a identificação do produto e o motivo da falha — zero falhas silenciosas.

## Assumptions

- O portal APW/Protheus (AutoAmerica e Roberlo) utiliza jQuery para eventos de formulário.
- A ausência de callback global tipo `SelTabela()` no portal não é um erro — `.trigger('change')` sozinho é suficiente se nenhum callback global existir.
- O campo `CJ_CONDPAG` (Condição de Pagamento) já usa `.trigger('change')` corretamente e não está no escopo desta correção, salvo se testes revelarem o contrário.
- Aliases extras coletados em runs anteriores são mantidos no banco — apenas a coleta de novos extras é removida.
- O modo `dryRun` (simulação) também se beneficia das correções, mas o comportamento de simulação em si não muda.
