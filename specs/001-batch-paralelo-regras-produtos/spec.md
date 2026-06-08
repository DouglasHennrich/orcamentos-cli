# Feature Specification: Batch Paralelo de Orçamentos e Regras de Produtos

**Feature Branch**: `001-batch-paralelo-regras-produtos`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "possibilidade de poder passar um array de orçamentos para serem executados em paralelo (com provider no JSON) e feature para definir regras de produtos por provider (add-product e override-discount) gerenciadas via editor interativo"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Executar múltiplos orçamentos em paralelo (Priority: P1)

O usuário quer gerar orçamentos em múltiplas plataformas (ou múltiplos pedidos de clientes diferentes) em uma única execução do CLI, sem precisar rodar o comando várias vezes em sequência. Ele prepara um arquivo JSON com um array de pedidos, cada um indicando seu provider, e executa o CLI uma única vez. Os orçamentos são processados em paralelo e cada um gera seu próprio PDF.

**Why this priority**: Elimina o principal gargalo operacional atual: ter que chamar o CLI N vezes para N orçamentos. É a mudança de maior impacto na produtividade.

**Independent Test**: Pode ser completamente testado criando um JSON com 2 pedidos (providers diferentes ou iguais) e verificando que ambos os PDFs são gerados ao final da execução.

**Acceptance Scenarios**:

1. **Given** um arquivo JSON contendo um array com 2 pedidos (um para `autoamerica`, outro para `roberlo`), **When** o usuário executa `agent-orcamento run -o pedidos.json`, **Then** ambos os orçamentos são processados simultaneamente e cada um gera seu próprio PDF.

2. **Given** um arquivo JSON contendo um objeto único com `"provider": "autoamerica"`, **When** o usuário executa `agent-orcamento run -o pedido.json`, **Then** o sistema processa o único orçamento normalmente.

3. **Given** um arquivo JSON com array de 3 pedidos onde o segundo falha (produto não encontrado), **When** o sistema processa os 3 em paralelo, **Then** o primeiro e o terceiro completam com sucesso e seus PDFs são gerados; o segundo registra o erro sem interromper os demais.

4. **Given** um arquivo JSON sem a key `provider` em um dos pedidos, **When** o usuário tenta executar, **Then** o CLI exibe uma mensagem de erro clara indicando qual pedido está sem `provider` e encerra sem processar nada.

---

### User Story 2 - Gerenciar regras de produtos via editor interativo (Priority: P2)

O usuário precisa definir, alterar e remover regras que se aplicam automaticamente a todos os orçamentos de um determinado provider. Por exemplo: "sempre adicionar 1 CX do produto X nos orçamentos Auto America" ou "sempre aplicar 15% de desconto no produto Y nos orçamentos Roberlo". O usuário acessa um editor interativo no CLI para gerenciar essas regras.

**Why this priority**: Sem as regras, o usuário precisa lembrar de adicionar produtos obrigatórios manualmente em cada JSON. As regras automatizam esse processo e reduzem erros.

**Independent Test**: Pode ser completamente testado criando uma regra de `add-product` para um provider, rodando um orçamento para esse provider, e verificando que o produto foi adicionado automaticamente.

**Acceptance Scenarios**:

1. **Given** nenhuma regra cadastrada, **When** o usuário executa `agent-orcamento rules`, **Then** o CLI exibe um menu interativo mostrando "Nenhuma regra cadastrada" e opções para criar uma nova regra.

2. **Given** o menu interativo aberto, **When** o usuário escolhe "Criar regra" e preenche provider=`autoamerica`, tipo=`add-product`, código=`404545002`, quantidade=`1 CX`, **Then** a regra é salva e listada no menu.

3. **Given** uma regra `add-product` ativa para `autoamerica` com produto X, **When** o usuário executa um orçamento para `autoamerica`, **Then** o produto X é automaticamente adicionado ao orçamento como se estivesse no JSON original.

4. **Given** uma regra `override-discount` ativa para produto Y com desconto 20%, **When** o sistema calcula descontos para um orçamento do provider correspondente, **Then** o desconto do produto Y é 20% independente do cálculo automático da plataforma.

5. **Given** uma regra existente, **When** o usuário a seleciona no editor e escolhe "Editar", **Then** o wizard abre com os valores atuais pré-preenchidos e o usuário pode alterar quantity (para add-product) ou discount_pct (para override-discount); o tipo e o código do produto não podem ser alterados (para editar esses campos, deletar e recriar a regra).

6. **Given** uma regra existente, **When** o usuário a seleciona no editor e escolhe "Desabilitar", **Then** a regra permanece salva mas não é aplicada nos orçamentos subsequentes.

7. **Given** uma regra existente, **When** o usuário a seleciona e escolhe "Deletar" com confirmação, **Then** a regra é removida permanentemente e não aparece mais na listagem.

---

### User Story 3 - Visualizar regras ativas antes do orçamento (Priority: P3)

O usuário quer ter visibilidade de quais regras serão aplicadas ao rodar um orçamento, sem precisar abrir o editor de regras. O CLI exibe as regras ativas do provider no início do processamento.

**Why this priority**: Melhora a transparência do processo sem bloquear o fluxo.

**Independent Test**: Pode ser testado verificando que a saída do CLI inclui a lista de regras ativas antes de começar a processar cada orçamento.

**Acceptance Scenarios**:

1. **Given** 2 regras ativas para `autoamerica`, **When** o usuário inicia um orçamento para `autoamerica`, **Then** o CLI exibe "Regras ativas (autoamerica): [lista das 2 regras]" antes de processar as linhas do pedido.

2. **Given** nenhuma regra ativa para `roberlo`, **When** o usuário inicia um orçamento para `roberlo`, **Then** o CLI não exibe nenhuma mensagem adicional sobre regras.

---

### Edge Cases

- O que acontece quando dois pedidos em paralelo tentariam gerar um PDF com o mesmo nome? Cada PDF deve ter nome único (inclui provider + timestamp ou número do orçamento).
- O que acontece quando uma regra `add-product` referencia um código de produto inexistente no portal? O erro deve ser propagado como falha daquele orçamento específico.
- O que acontece quando o array de pedidos está vazio `[]`? O CLI deve reportar erro informando que nenhum pedido foi fornecido.
- Como o sistema lida com um pedido que já contém o mesmo produto que uma regra `add-product`? As quantidades devem ser somadas (não duplicar a linha).
- O que acontece se a regra de desconto override é `0%`? É uma configuração válida que anula o desconto automático do produto.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Feature 1: Batch Paralelo com Provider no JSON

- **FR-001**: O sistema DEVE aceitar um arquivo JSON contendo um objeto único com a key `provider` obrigatória (`"autoamerica"` ou `"roberlo"`).
- **FR-002**: O sistema DEVE aceitar um arquivo JSON contendo um array de objetos, cada um com a key `provider` obrigatória.
- **FR-003**: O comando `run` DEVE remover a flag `--platform`; o provider passa a ser obrigatoriamente definido no JSON.
- **FR-004**: Quando o JSON for um array, o sistema DEVE processar todos os pedidos em paralelo (simultaneamente), respeitando um limite padrão de 3 execuções simultâneas.
- **FR-004a**: O sistema DEVE permitir configurar o limite de paralelismo via flag `--concurrency` (default: 3).
- **FR-005**: A falha de um orçamento em paralelo NÃO DEVE cancelar nem interromper os demais orçamentos em execução.
- **FR-006**: Cada orçamento bem-sucedido DEVE gerar seu próprio arquivo PDF com nome único.
- **FR-007**: O sistema DEVE exibir o resultado de cada orçamento (total, parcelas, caminho do PDF) à medida que cada um termina.
- **FR-008**: O sistema DEVE exibir erros de orçamentos que falharam sem ocultar os demais resultados.
- **FR-008a**: Ao final do processamento de um lote, o sistema DEVE exibir uma tabela SUMMARY consolidando o status (Sucesso/Falha) e detalhes de cada pedido.
- **FR-009**: O sistema DEVE validar a presença da key `provider` em cada pedido antes de iniciar o processamento; se ausente em qualquer pedido, exibe erro e encerra sem processar nada.
- **FR-010**: O sistema DEVE validar que o valor de `provider` é `"autoamerica"` ou `"roberlo"`; valores inválidos resultam em erro descritivo.
- **FR-010a**: Em modo batch (JSON array com N > 1 pedidos), prompts interativos NÃO são suportados. Se qualquer orçamento encontrar uma situação que exigiria intervenção do usuário (produto sem alias conhecido, valor mínimo inatingível sem bump manual), esse orçamento DEVE falhar com mensagem descritiva sem bloquear os demais.
- **FR-010b**: Em modo single (JSON objeto único), o comportamento interativo atual (prompts de alias e bump de valor mínimo) DEVE ser preservado sem alteração.

#### Feature 2: Regras de Produtos

- **FR-011**: O sistema DEVE persistir regras de produtos em armazenamento local (no mesmo banco de dados de aliases existente, nova tabela dedicada).
- **FR-012**: Cada regra DEVE ter: identificador único, provider (`autoamerica` | `roberlo`), tipo (`add-product` | `override-discount`), código do produto, estado (habilitada/desabilitada).
- **FR-012a**: O sistema DEVE garantir a unicidade de uma regra baseada no trio: `provider` + `type` + `product_code`. Não é permitido ter duas regras do mesmo tipo para o mesmo produto no mesmo provider.
- **FR-013**: Regras do tipo `add-product` DEVEM ter quantity obrigatória, persistida em duas colunas: `quantity_value` (inteiro) e `quantity_unit` (`UN` ou `CX`).
- **FR-014**: Regras do tipo `override-discount` DEVEM ter percentual de desconto obrigatório (número entre -100 e 100).
- **FR-015**: O sistema DEVE fornecer um subcomando `rules` com editor interativo que permita: listar, criar, editar, habilitar/desabilitar e deletar regras.
- **FR-015a**: O subcomando `rules` DEVE iniciar solicitando que o usuário escolha um `provider` para gerenciar.
- **FR-016**: A criação de regra via editor interativo DEVE guiar o usuário passo a passo (wizard): tipo → código do produto → quantidade/desconto.
- **FR-017**: A listagem de regras DEVE exibir: índice, estado (ativo/inativo), tipo, código do produto, e quantidade ou percentual.
- **FR-018**: A deleção de regra DEVE exigir confirmação explícita do usuário antes de remover.
- **FR-019**: Antes de processar as linhas de um pedido, o sistema DEVE carregar e aplicar automaticamente todas as regras habilitadas do provider correspondente.
- **FR-020**: Regras `add-product` DEVEM ser injetadas no conjunto de linhas do pedido como novas linhas identificadas pelo código exato do produto (não pelo nome); se uma linha com o mesmo código do produto já existe no pedido (após resolução de aliases), as quantidades DEVEM ser somadas em vez de criar linha duplicada.
- **FR-021**: Regras `override-discount` DEVEM substituir o desconto calculado automaticamente pela plataforma para o produto especificado.
- **FR-022**: Quando o orçamento for iniciado, o sistema DEVE exibir as regras ativas do provider caso existam.

### Key Entities

- **Pedido (Order)**: Representa um orçamento a ser gerado. Atributos: `provider`, `client`, `produtos` (array de linhas com `name` e `quantity`).
- **Lote (Batch)**: Um conjunto de pedidos a serem processados em paralelo. Pode ter 1 ou N pedidos.
- **Regra de Produto (ProductRule)**: Regra persistida que afeta a composição ou preço de um orçamento. Atributos: `id`, `provider`, `type`, `product_code`, `product_name` (opcional), `quantity_value`, `quantity_unit` (para add-product), `discount_pct` (para override-discount), `enabled`, `created_at`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário consegue processar N orçamentos em uma única chamada ao CLI, com tempo total próximo ao do orçamento mais lento respeitando o limite de paralelismo (default 3).
- **SC-002**: O usuário consegue criar uma nova regra de produto em menos de 60 segundos via editor interativo.
- **SC-003**: Regras ativas são aplicadas em 100% dos orçamentos do provider correspondente sem intervenção manual.
- **SC-004**: Um orçamento com falha em lote não impede os demais de completar; o usuário recebe uma tabela summary clara com o status de cada item ao final.
- **SC-005**: O usuário consegue identificar todas as regras ativas para um provider em uma única tela do editor interativo.
- **SC-006**: O exemplo `pedido.example.json` é atualizado para refletir o novo formato obrigatório com `provider`.

---

## Assumptions

- O usuário possui credenciais válidas para cada provider presente no lote; se um provider não tiver credenciais configuradas, apenas aquele orçamento falha.
- O banco de dados de aliases existente (`aliases.db`) é acessível para criação da nova tabela `product_rules`; nenhuma migração manual é necessária pelo usuário.
- A execução paralela abre uma instância de browser por orçamento; o número máximo de instâncias simultâneas é uma decisão de implementação (fora do escopo desta spec).
- O código do produto informado em uma regra `add-product` deve ser o código exato do portal para evitar ambiguidade na resolução.
- Regras `add-product` participam do loop de valor mínimo (bump) da mesma forma que qualquer outra linha do pedido.
- O subcomando `rules` pode ser executado de forma independente, sem necessidade de um orçamento ativo.
- O `pedido.example.json` será atualizado para o novo formato; não haverá caminho de migração automática para JSONs antigos (breaking change aceito).
