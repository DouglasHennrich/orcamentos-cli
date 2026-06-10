# Feature Specification: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Feature Branch**: `004-prompt-threshold-screenshot`

**Created**: 2026-06-09

**Status**: Draft

**Input**: brainstorm/03-prompt-concorrencia-threshold-scope-screenshot.md

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Batch paralelo sem prompts embaralhados (Priority: P1)

O operador executa um orçamento em batch com 2 pedidos em paralelo. Ambos os pedidos encontram um produto não cadastrado e precisam de input interativo. O sistema pausa o segundo pedido e exibe o prompt do primeiro com o contexto `[autoamerica / CLIENTE ABC]`. Após a resposta, o segundo pedido é retomado e apresenta seu próprio prompt com o contexto adequado.

**Why this priority**: Sem serialização de prompts, o terminal exibe perguntas embaralhadas de pedidos diferentes, tornando impossível para o operador saber qual pedido está sendo resolvido. Este é o único cenário que torna o batch interativo completamente inutilizável.

**Independent Test**: Rodar um JSON com 2 pedidos em paralelo onde ambos têm produtos desconhecidos. O sistema deve exibir prompts sequencialmente com o contexto `[provider / cliente]` visível antes de cada pergunta.

**Acceptance Scenarios**:

1. **Given** um batch com 2 pedidos em paralelo, **When** ambos encontram produto não encontrado ao mesmo tempo, **Then** o sistema exibe o prompt de um pedido por vez, com prefixo `[provider / cliente]`, nunca interleando perguntas de pedidos diferentes
2. **Given** o pedido A está aguardando resposta do usuário, **When** o pedido B também precisa de input, **Then** o pedido B aguarda silenciosamente até o pedido A receber resposta
3. **Given** o usuário responde ao prompt do pedido A, **When** a resposta é registrada, **Then** o pedido A continua processando e o pedido B imediatamente recebe sua vez de perguntar
4. **Given** um batch com 1 único pedido, **When** o produto não é encontrado, **Then** o comportamento é idêntico ao comportamento atual (sem regressão)

---

### User Story 2 — Threshold-discount com escopo por produto específico (Priority: P2)

O operador acessa `agent-orcamento rules` e cria uma regra de desconto por quantidade. O wizard pergunta se o desconto aplica a todos os produtos ou a um produto específico. O operador escolhe "produto específico", informa o código e nome do produto. Se o produto não existir no banco, o sistema cria o registro. A regra é salva e aplicada apenas ao produto indicado durante os orçamentos futuros.

**Why this priority**: O modelo atual (`threshold-discount` sempre global) não permite desconto diferenciado por volume para produtos específicos — caso comum em negociações comerciais com produtos individuais.

**Independent Test**: Criar uma regra de threshold para um produto específico via `rules`, então rodar um orçamento com 2 produtos: um que atende o threshold e outro que não. O desconto deve ser aplicado somente ao produto que corresponde ao código da regra.

**Acceptance Scenarios**:

1. **Given** o operador está criando uma regra `threshold-discount`, **When** o wizard pergunta o escopo, **Then** o sistema apresenta as opções: (1) Todos os produtos e (2) Produto específico
2. **Given** o operador escolhe "Produto específico", **When** informa um código e nome que não existe no banco, **Then** o sistema cria o alias com os dados fornecidos e confirma antes de salvar a regra
3. **Given** o operador escolhe "Produto específico" e informa um código já cadastrado, **When** confirma, **Then** o sistema usa o registro existente sem criar duplicata
4. **Given** uma regra `threshold-discount` com `product_code` real existe, **When** o orçamento tem um produto que corresponde ao código e atinge o threshold em quantidade, **Then** o desconto da regra é aplicado a esse produto
5. **Given** uma regra `threshold-discount` com `product_code` real existe, **When** o orçamento tem um produto que NÃO corresponde ao código (mas atinge o threshold em quantidade), **Then** a regra não se aplica e o desconto automático da plataforma é usado
6. **Given** uma regra `threshold-discount` global (`*`) e uma regra específica coexistem para o mesmo provider e threshold, **When** um produto específico atende ambas, **Then** a regra do produto específico tem prioridade

---

### User Story 3 — Screenshot automático de auditoria antes de salvar (Priority: P2)

O operador executa um orçamento normalmente. Antes do sistema finalizar e salvar o orçamento no portal, é capturado automaticamente um screenshot full-page da tela. O arquivo é salvo no mesmo diretório do PDF exportado com o mesmo nome base, com extensão `.png`. Ao final, o operador encontra, lado a lado no diretório de exportação, `CLIENTE.pdf` e `CLIENTE.png`.

**Why this priority**: A correlação entre o PDF exportado e o estado visual do orçamento no momento da submissão é necessária para auditoria. Sem o screenshot, é impossível verificar o que estava na tela quando o orçamento foi submetido.

**Independent Test**: Rodar um orçamento completo (não dry-run) e verificar que no diretório de exportação existe um arquivo `.png` com o mesmo nome base do `.pdf` gerado.

**Acceptance Scenarios**:

1. **Given** um orçamento está pronto para ser finalizado, **When** o sistema se prepara para salvar no portal, **Then** um screenshot full-page é capturado antes da ação de salvar
2. **Given** o screenshot foi capturado com sucesso, **When** o PDF é exportado para `<dir>/<provider>/<cliente>.pdf`, **Then** o screenshot é salvo em `<dir>/<provider>/<cliente>.png`
3. **Given** a captura de screenshot falha (ex: browser timeout), **When** o erro ocorre, **Then** o sistema registra um aviso no log mas continua o fluxo de salvar e exportar normalmente (falha não-fatal)
4. **Given** o orçamento está em modo dry-run, **When** o fluxo é executado, **Then** nenhum screenshot é capturado
5. **Given** o operador passou `--screenshot <path>` explicitamente na CLI, **When** o orçamento é executado, **Then** o path explícito é usado em vez do path derivado automaticamente (compatibilidade retroativa)

---

### Edge Cases

- O que acontece quando o batch tem N pedidos em paralelo e todos encontram produto não encontrado simultaneamente? A fila de prompts deve processar um por vez, sem deadlock.
- O que acontece quando o usuário digita uma resposta inválida enquanto tem o mutex de prompt? O prompt deve reapresentar a pergunta (ainda com mutex adquirido) antes de liberar.
- O que acontece quando o produto informado para `threshold-discount` específico tem código já usado por uma regra `override-discount`? As regras são independentes — coexistem normalmente.
- O que acontece com o screenshot quando o diretório de exportação ainda não existe? O diretório deve ser criado junto com o PNG (mesmo comportamento já aplicado ao PDF).
- O que acontece com regras `threshold-discount` globais já existentes (`product_code = '*'`) após essa mudança? Continuam funcionando exatamente como antes — zero migração de dados.

## Requirements *(mandatory)*

### Functional Requirements

**Prompt Concorrência**

- **FR-001**: O sistema DEVE garantir que apenas um prompt interativo esteja ativo no terminal por vez, mesmo quando múltiplos orçamentos estão sendo processados em paralelo
- **FR-002**: Todo prompt interativo DEVE exibir um prefixo de contexto no formato `[<provider> / <cliente>]` antes da pergunta, identificando qual pedido está sendo resolvido
- **FR-003**: A liberação da vez de prompt DEVE ocorrer somente após o usuário fornecer uma resposta válida (incluindo re-perguntas por entrada inválida)
- **FR-004**: O mecanismo de serialização de prompts DEVE ser transparente para o código que chama o prompter — sem mudança na interface pública do `Prompter`

**Threshold-discount Scope**

- **FR-005**: O wizard de criação/edição de regras `threshold-discount` DEVE perguntar o escopo: (1) Todos os produtos ou (2) Produto específico
- **FR-006**: Quando o escopo for "Produto específico", o sistema DEVE solicitar o código e o nome do produto
- **FR-007**: Quando código + nome informados não existirem no banco de aliases, o sistema DEVE criar um novo registro de alias antes de salvar a regra
- **FR-008**: Quando código + nome informados já existirem no banco, o sistema DEVE usar o registro existente sem criar duplicata
- **FR-009**: Uma regra `threshold-discount` com `product_code` real DEVE ser aplicada somente ao produto do orçamento cujo código corresponde exatamente
- **FR-010**: Uma regra `threshold-discount` com `product_code = '*'` DEVE continuar aplicando-se a todos os produtos (comportamento existente preservado)
- **FR-011**: Quando um produto atende tanto uma regra global (`*`) quanto uma regra específica pelo mesmo threshold, a regra específica DEVE ter prioridade. Quando múltiplas regras específicas de produtos distintos coexistem com o mesmo threshold, cada regra aplica-se somente ao seu próprio produto — não há conflito entre elas
- **FR-012**: A constraint de unicidade das regras DEVE prevenir duplicatas de `(provider, type, product_code, quantity_value)` — permitindo o mesmo threshold para produtos diferentes

**Screenshot de Auditoria**

- **FR-013**: O sistema DEVE capturar automaticamente um screenshot full-page antes de salvar o orçamento no portal, em todo run não-dry-run com export habilitado
- **FR-014**: O path do screenshot DEVE ser derivado do path do PDF, substituindo a extensão `.pdf` por `.png`
- **FR-015**: Falha na captura de screenshot DEVE ser tratada como aviso não-fatal — o fluxo de salvar e exportar DEVE continuar normalmente
- **FR-016**: Em modo dry-run, nenhum screenshot DEVE ser capturado
- **FR-017**: O flag `--screenshot <path>` existente na CLI DEVE continuar funcionando e, quando fornecido, DEVE sobrescrever o path derivado automaticamente

### Key Entities

- **PromptContext**: Informação de contexto associada a um prompt interativo — inclui `provider` e `clientName` para exibição do prefixo `[provider / cliente]`
- **ProductRule (threshold-discount)**: Regra de desconto por volume — campo `product_code` podendo ser `'*'` (global) ou código real (específico); identificada unicamente por `(provider, type, product_code, quantity_value)`
- **AuditScreenshot**: Arquivo de imagem gerado antes de cada salvamento de orçamento — co-localizado com o PDF exportado, mesmo nome base, extensão `.png`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em um batch com N pedidos em paralelo, zero prompts interativos aparecem embaralhados no terminal — cada pergunta é exibida com seu contexto completo e único antes da próxima ser apresentada
- **SC-002**: O operador consegue criar uma regra `threshold-discount` com escopo de produto específico em uma única sessão do wizard, sem precisar criar regras `override-discount` individuais
- **SC-003**: Para cada PDF exportado em run não-dry-run, um arquivo `.png` correspondente é encontrado no mesmo diretório, com o mesmo nome base
- **SC-004**: Uma falha na captura de screenshot não interrompe a exportação do PDF — a taxa de sucesso de exportação de PDF permanece inalterada
- **SC-005**: Regras `threshold-discount` globais existentes continuam funcionando sem modificação após o deploy — zero regressões nos orçamentos que usavam a regra global

## Out of Scope

- Screenshot em modo dry-run (FR-016 cobre explicitamente)
- Screenshot quando `--output` não está definido (sem PDF → sem screenshot derivado)
- Suporte a outros formatos de imagem além de PNG
- Exibição de notificação visual/sonora ao usuário quando um prompt está aguardando na fila
- Regras `threshold-discount` com threshold diferente por unidade de medida (ex: por peça vs por caixa) — `quantity_value` sempre refere-se à unidade já em uso no sistema

## Assumptions

- O operador sempre executa o CLI em um terminal interativo ao processar batch com múltiplos pedidos (TTY disponível); modo não-interativo (pipe/stdin) já opera sem prompts pelo mecanismo existente
- O `clientName` está disponível no contexto do orchestrator no momento em que o prompt é disparado (resolvido durante `startQuote`)
- Ambos os drivers (AutoAmerica e Roberlo) já implementam `captureScreenshot` — nenhuma mudança na interface de driver é necessária
- O path do PDF é determinado antes da chamada de `driver.save()`, permitindo derivar o path do screenshot no mesmo ponto
- Regras `threshold-discount` com `product_code` real que não correspondem a nenhum produto no pedido atual são silenciosamente ignoradas (sem aviso de runtime)
- Nenhuma migração de dados é necessária — regras existentes com `product_code = '*'` continuam válidas sem alteração
