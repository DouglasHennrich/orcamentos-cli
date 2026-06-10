# Brainstorm: Prompt Concorrência, Threshold Scope e Screenshot de Auditoria

**Date:** 2026-06-09
**Status:** active

## Problem Framing

Três melhorias independentes ao sistema de orçamentos:

1. **Concorrência de prompts no batch**: Quando múltiplos pedidos rodam em paralelo e ambos precisam de input interativo (ex: produto não encontrado), os prompts se interleavam no terminal — o `ConsolePrompter` usa um único `readline` com buffer compartilhado, sem coordenação entre corrotinas concorrentes. O usuário não sabe qual pedido está sendo perguntado.

2. **Escopo do threshold-discount**: A regra `threshold-discount` aplica desconto por volume a `product_code = '*'` (todos os produtos do provider). O usuário quer poder criar regras de threshold que apliquem a apenas um produto específico — o escopo deve ser definido no wizard de criação da regra.

3. **Screenshot automático de auditoria**: Antes de finalizar o orçamento (antes de salvar no portal), o sistema deve capturar um screenshot full-page e salvá-lo no mesmo diretório e com o mesmo nome base do PDF gerado, apenas trocando a extensão para `.png`. Serve para correlacionar visualmente o PDF exportado com o estado do orçamento no momento da submissão.

## Approaches Considered

### Tópico 1 — Concorrência de prompts

#### A: Mutex no ConsolePrompter ⭐ Escolhido
- Um `promptMutex` interno garante que apenas um prompt está ativo por vez. Outras corrotinas que tentam prompt durante esse período ficam enfileiradas e retomam automaticamente após a resposta.
- O prompt exibe o contexto `[provider / cliente]` antes de cada pergunta para o usuário saber qual pedido está sendo resolvido.
- Pros: sem mudança na interface `Prompter`; funciona automaticamente para qualquer número de orders; código de chamada (resolver, orchestrator) não precisa saber do mutex
- Cons: pedido que espera fica "congelado" visivelmente — comportamento correto e desejado

#### B: PromptQueueManager injetável
- Novo serviço `PromptQueueManager` com DI explícita no batch-runner
- Pros: mais testável isoladamente
- Cons: boilerplate adicional; mesma semântica da A

#### C: Modo não-interativo no batch multi-pedido
- Quando há mais de 1 pedido no batch, prompts são desabilitados; produtos não resolvidos geram erro no summary
- Pros: sem complexidade de sincronização
- Cons: perde capacidade interativa em qualquer batch — reduz utilidade do sistema

### Tópico 2 — Escopo do threshold-discount

#### A: Escopo definido no wizard de criação de regra ⭐ Escolhido
- O wizard de `agent-orcamento rules` para o tipo `threshold-discount` pergunta: "Aplicar a (1) Todos os produtos (2) Produto específico". Se (2), pede código + nome do produto; se não existir no DB, cria o alias automaticamente. Em runtime, o orchestrator filtra: `product_code = '*'` → todos; código real → só aquele produto.
- Pros: padrão já usado pelo `override-discount`; reutiliza lookup de alias; nenhum prompt em runtime
- Cons: constraint UNIQUE da tabela precisa incluir `product_code` para permitir o mesmo threshold por produtos diferentes

#### B: Novo tipo de regra `threshold-discount-product`
- Tipo separado para threshold por produto específico
- Pros: semântica explícita no campo `type`
- Cons: duplica lógica; o campo `product_code = '*'` já modela a distinção com elegância

### Tópico 3 — Screenshot de auditoria

#### A: Path derivado automaticamente do PDF ⭐ Escolhido
- Antes de salvar o orçamento no portal, o orchestrator chama `captureScreenshot` com path `<baseDir>/<platform>/<fileBaseName>.png` — mesmo local e nome do PDF exportado, só troca a extensão.
- Nenhuma flag adicional; screenshot é sempre gerado quando há export habilitado (modo não dry-run).
- Pros: reutiliza `captureScreenshot` existente em ambos os drivers; zero config; par PDF + PNG fica lado a lado no filesystem
- Cons: sempre gera screenshot (sem opt-out) — mas isso é o comportamento desejado para auditoria obrigatória

#### B: Flag `--no-screenshot` para desabilitar
- Igual ao A, mas adiciona flag opcional para desabilitar
- Pros: flexibilidade
- Cons: complexidade desnecessária para requisito de auditoria

## Decision

**Tópico 1**: Abordagem A — mutex interno no `ConsolePrompter`. Cada chamada a `ask()`, `askInt()`, `askInts()` e `choose()` adquire o mutex antes de escrever no stdout e libera após receber a resposta. O contexto `[provider / cliente]` é passado como prefixo ao prompt para identificar o pedido em pausa.

**Tópico 2**: Abordagem A — escopo definido no wizard de criação. O campo `product_code` da tabela `product_rules` passa a aceitar tanto `'*'` (global) quanto um código real de produto para `threshold-discount`. Constraint UNIQUE atualizada para `(provider, type, product_code, quantity_value)`. Runtime já usa `product_code` para filtrar — basta ajustar a consulta.

**Tópico 3**: Abordagem A — screenshot automático full-page antes de salvar. O orchestrator deriva o path do screenshot a partir do path do PDF (substitui `.pdf` por `.png`) e chama `captureScreenshot` antes de `driver.save()`. Funciona em ambos os drivers que já implementam o método.

## Key Requirements

### Prompt Concorrência
- `ConsolePrompter` implementa um mutex assíncrono interno (ex: usando uma `Promise` de lock)
- Todas as funções públicas (`ask`, `askInt`, `askInts`, `choose`) adquirem o mutex antes de qualquer escrita em stdout ou leitura de stdin
- A liberação do mutex ocorre após a resposta válida ser retornada
- O orchestrator/resolver passa o contexto `[provider / cliente]` como prefixo ao chamar o prompter (via parâmetro ou propriedade configurável)
- Comportamento visual: o pedido que "ganhou" o mutex exibe `[autoamerica / CLIENTE ABC] Produto 'LIXA 180' não encontrado...`; o outro pedido aguarda na fila interna sem interromper o terminal

### Threshold-discount Scope
- O wizard de criação de regra `threshold-discount` adiciona passo: "Escopo: (1) Todos os produtos (2) Produto específico"
- Se (2): pede `código do produto` e `nome do produto`; faz lookup no repositório de aliases; se não existir, cria um novo alias com o código + nome informados
- A tabela `product_rules` tem UNIQUE em `(provider, type, product_code, quantity_value)` — permitindo a mesma quantity para produtos diferentes
- Em runtime, o orchestrator filtra `threshold-discount` por `product_code`: `'*'` aplica a todos; código real aplica apenas ao produto correspondente no pedido

### Screenshot de Auditoria
- O orchestrator, ao preparar o export, deriva o path do screenshot: `pdfPath.replace(/\.pdf$/, '.png')`
- Antes de chamar `driver.save()` (finalizar o orçamento), chama `driver.captureScreenshot(screenshotPath)` com `fullPage: true`
- Se `captureScreenshot` falhar, logar aviso mas não abortar o fluxo de salvamento
- O `--screenshot` flag existente na CLI é mantido para compatibilidade (sobrescreve o path automático se fornecido)
- Em modo dry-run, screenshot não é capturado (não há orçamento real para auditar)

## Open Questions

- O mutex do `ConsolePrompter` deve ser implementado com uma biblioteca (ex: `async-mutex`) ou artesanalmente com Promise chain?
- Quando o threshold-discount tem `product_code` real e o produto não está no orçamento corrente, a regra é silenciosamente ignorada ou gera aviso?
- O screenshot automático deve também funcionar no dry-run (para validar o estado antes de salvar) ou apenas no run real?
