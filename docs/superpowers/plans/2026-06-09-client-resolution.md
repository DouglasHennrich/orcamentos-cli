# Implementação de Resolução Interativa de Cliente e Tabela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a busca interativa e o cache de clientes, além da seleção obrigatória de tabela de preços, garantindo que o fluxo de orçamento seja robusto e ocorra na ordem correta (Cliente -> Tabela -> Produtos).

**Architecture:** 
- Novo `ClientRepository` para cachear de-para de clientes no SQLite.
- Novos métodos na `IPortalDriver` para busca de clientes e tabelas.
- Novo `client-resolver.ts` para orquestrar a lógica de "cache -> busca -> interativo".
- Refatoração do `orchestrator.ts` para separar as fases de inicialização das fases de resolução de itens.

**Tech Stack:** TypeScript, node:sqlite, agent-browser CLI.

---

### Task 1: Schema e Repositório de Clientes

**Files:**
- Modify: [src/db/schema.ts](src/db/schema.ts)
- Create: [src/db/client-repository.ts](src/db/client-repository.ts)
- Test: [tests/db/client-repository.test.ts](tests/db/client-repository.test.ts)

- [ ] **Step 1: Adicionar CREATE_CLIENT_ALIASES ao schema**
- [ ] **Step 2: Criar ClientRepository com métodos find e save**
- [ ] **Step 3: Criar teste unitário para o repositório**
- [ ] **Step 4: Rodar testes e commitar**

### Task 2: Atualizar Interfaces e Tipos

**Files:**
- Modify: [src/platforms/types.ts](src/platforms/types.ts)

- [ ] **Step 1: Adicionar ClientOption e PriceTableOption às interfaces**
- [ ] **Step 2: Adicionar searchClients, selectClient, listPriceTables e selectPriceTable à IPortalDriver**
- [ ] **Step 3: Commitar**

### Task 3: Implementar Busca de Clientes no AutoAmericaDriver

**Files:**
- Modify: [src/platforms/autoamerica-driver.ts](src/platforms/autoamerica-driver.ts)

- [ ] **Step 1: Implementar searchClients (usa CJ_CLIENTE options)**
- [ ] **Step 2: Implementar selectClient (usa val().trigger('change') + SelCliente())**
- [ ] **Step 3: Implementar listPriceTables (lê CJ_TABELA options após SelCliente)**
- [ ] **Step 4: Implementar selectPriceTable (usa val().trigger('change') + selProd())**
- [ ] **Step 5: Commitar**

### Task 4: Implementar Busca de Clientes no RoberloDriver

**Files:**
- Modify: [src/platforms/roberlo-driver.ts](src/platforms/roberlo-driver.ts)

- [ ] **Step 1: Implementar searchClients**
- [ ] **Step 2: Implementar selectClient**
- [ ] **Step 3: Implementar listPriceTables**
- [ ] **Step 4: Implementar selectPriceTable**
- [ ] **Step 5: Commitar**

### Task 5: Criar ClientResolver

**Files:**
- Create: [src/orcamento/client-resolver.ts](src/orcamento/client-resolver.ts)

- [ ] **Step 1: Implementar lógica de buscar no repo ou perguntar via prompter**
- [ ] **Step 2: Integrar com driver.searchClients e driver.selectClient**
- [ ] **Step 3: Implementar lógica de escolha de tabela de preço**
- [ ] **Step 4: Commitar**

### Task 6: Refatorar Orchestrator

**Files:**
- Modify: [src/orcamento/orchestrator.ts](src/orcamento/orchestrator.ts)

- [ ] **Step 1: Remover lógica de cliente de startQuote**
- [ ] **Step 2: Adicionar chamada ao client-resolver no início de runOrcamento**
- [ ] **Step 3: Chamar selectPriceTable do driver**
- [ ] **Step 4: Validar fluxo completo com dry-run**
- [ ] **Step 5: Commitar**
