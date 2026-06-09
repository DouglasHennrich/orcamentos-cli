# Design — Resolução Interativa de Cliente e Tabela de Preço

**Data:** 2026-06-09
**Status:** Em Revisão
**Tópico:** `docs/superpowers/specs/2026-06-09-client-resolution-design.md`

## 1. Objetivo

Garantir que a seleção do cliente e da tabela de preço seja robusta, interativa e ocorra antes de qualquer outra ação no portal. O sistema deve cachear de-para de nomes/CNPJs para códigos internos do portal e permitir que o usuário escolha manualmente caso o cliente não seja encontrado.

## 2. Fluxo de Execução Atualizado

O `orchestrator.ts` seguirá esta nova sequência:

1. **Login:** Acesso ao portal.
2. **Navegação:** Ir até a tela de novo orçamento.
3. **Resolução de Cliente:**
   - Busca no cache local (`client_aliases`).
   - Se falhar: Busca "ao vivo" no portal + Usuário escolhe + Persiste no cache.
4. **Seleção de Cliente:** Injeta código no portal e aguarda trigger de "Tabela de Preços".
5. **Resolução de Tabela de Preço:**
   - Lista tabelas disponíveis para aquele cliente.
   - Se `platformConfig.tabelaPrecos` bater com alguma, usa ela.
   - Caso contrário (ou se ambíguo): Pergunta ao usuário qual usar.
6. **Seleção de Tabela:** Injeta código e aguarda carregamento dos produtos.
7. **Resolução de Produtos:** Segue o fluxo já existente.

## 3. Mudanças no Modelo de Dados

### 3.1 SQLite (`src/db/schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS client_aliases (
  platform      TEXT NOT NULL,    -- 'autoamerica' | 'roberlo'
  alias_norm    TEXT NOT NULL,    -- normalizado: minúsculo, sem acento
  alias_raw     TEXT NOT NULL,    -- como veio no JSON ("Oliveira Oliveira")
  client_code   TEXT NOT NULL,    -- código interno do portal
  client_name   TEXT NOT NULL,    -- nome completo no portal
  created_at    TEXT NOT NULL,
  PRIMARY KEY (platform, alias_norm)
);
```

## 4. Mudanças na Interface do Driver (`src/platforms/types.ts`)

Novos métodos necessários para suportar o fluxo interativo:

- `searchClients(terms: string): Promise<DriverResult<ClientOption[]>>`
- `selectClient(code: string): Promise<DriverResult>`
- `listPriceTables(): Promise<DriverResult<PriceTableOption[]>>`
- `selectPriceTable(code: string): Promise<DriverResult>`

## 5. Estratégia de Robustez na Seleção

Para garantir que o portal reconheça a seleção:
1. Usar `jQuery('#ID').val(valor).trigger('change')`.
2. Em seguida, chamar as funções de callback globais do portal (ex: `SelCliente()`, `selProd()`) via `eval`.
3. Validar se o próximo campo (tabela ou produto) foi preenchido/habilitado antes de prosseguir.

## 6. Módulos a Criar/Editar

- `src/db/client-repository.ts`: CRUD para o cache de clientes.
- `src/orcamento/client-resolver.ts`: Lógica de "cache -> busca -> pergunta".
- `src/platforms/autoamerica-driver.ts` & `roberlo-driver.ts`: Implementar novos métodos de cliente/tabela.
- `src/orcamento/orchestrator.ts`: Reordenar para cliente -> tabela -> produtos.
