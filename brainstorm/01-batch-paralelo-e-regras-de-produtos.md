# Brainstorm: Batch Paralelo e Regras de Produtos

**Date:** 2026-06-08
**Status:** active

## Problem Framing

O CLI atual processa um único orçamento por vez para uma única plataforma, com o provider especificado via flag `--platform`. Precisamos de duas evoluções independentes:

1. **Batch/Paralelo**: Poder passar múltiplos orçamentos (cada um com seu próprio provider) em um único arquivo JSON e executá-los em paralelo — eliminando a necessidade de rodar o CLI múltiplas vezes.

2. **Regras de Produtos**: Definir regras persistentes por provider que são aplicadas automaticamente em todo orçamento. Dois tipos de regra: injetar um produto (com quantidade) ou sobrescrever o desconto de um produto específico.

## Approaches Considered

### Feature 1 — Batch/Paralelo

#### A: JSON flexível (objeto único ou array) ⭐ Escolhido
- Pros: Compatível com uso simples sem mudar o formato; suporta batch sem schema diferente por pedido; a key `provider` fica embutida no pedido (faz mais sentido semântico)
- Cons: Parser precisa distinguir objeto/array na entrada

#### B: JSON sempre array
- Pros: Schema mais previsível
- Cons: Incomoda para uso simples (precisa envolver em colchetes)

#### C: Objeto wrapper com key `orders`
- Pros: Extensível
- Cons: Verboso demais para o caso de uso

### Feature 2 — Regras de Produtos

#### A: Injeção silenciosa com editor interativo ⭐ Escolhido
- Pros: Reaproveita todo o fluxo de resolução existente (alias DB, fuzzy match); duas regras (add-product e override-discount) cobrem todos os casos de uso descritos
- Cons: Erros de código inválido só aparecem na hora de rodar

#### B: Regras com condições (cliente, total, etc.)
- Pros: Mais flexível
- Cons: Complexidade desnecessária

#### C: Arquivo JSON separado para regras
- Pros: Fácil de versionar
- Cons: Dois sistemas de persistência; SQLite já foi escolhido

## Decision

**Feature 1**: Abordagem A — JSON flexível. O `--platform` flag é removido (breaking change aceito). O JSON deve incluir `provider: "autoamerica" | "roberlo"` em cada pedido. Suporta tanto objeto único quanto array para batch paralelo. Cada orçamento gera seu próprio PDF.

**Feature 2**: Abordagem A — com dois tipos de regra:
- `add-product`: injeta uma linha de produto (code + quantity) antes de rodar o orçamento, como se estivesse no JSON original
- `override-discount`: sobrescreve o desconto calculado por `platform.computeLineDiscount` para um produto específico (o valor da regra substitui, não soma)

Regras são scoped por provider. Aplicadas automaticamente (sem confirmação). Armazenadas no SQLite existente (nova tabela `product_rules`). Gerenciadas via editor interativo: `agent-orcamento rules`.

## Key Requirements

### Feature 1 — Batch/Paralelo
- Remover flag `--platform` do comando `run`
- JSON de pedido passa a exigir key `provider: "autoamerica" | "roberlo"`
- JSON pode ser um objeto único (1 orçamento) ou um array (N orçamentos)
- Quando array, os N orçamentos são executados em paralelo (Promise.all ou equivalente)
- Cada orçamento gera seu próprio PDF independentemente
- Falha em um orçamento não deve cancelar os demais
- Atualizar `pedido.example.json` para o novo formato
- Atualizar validação no `parseOrder` para aceitar os dois formatos

### Feature 2 — Regras de Produtos
- Nova tabela `product_rules` no SQLite com campos: `id`, `provider`, `type` (`add-product` | `override-discount`), `product_code`, `product_name` (opcional), `quantity` (para add-product), `discount_pct` (para override-discount), `enabled` (boolean), `created_at`
- Repositório `ProductRulesRepository` análogo ao `AliasRepository` existente
- Antes de processar qualquer `orderLines`, o orchestrator carrega e injeta regras `add-product` para o provider em questão
- Na etapa de aplicação de descontos, regras `override-discount` substituem o valor calculado
- Novo subcomando `agent-orcamento rules` com editor interativo:
  - Listar regras ativas (com índice, tipo, provider, produto, quantidade/desconto)
  - Criar nova regra (wizard passo a passo)
  - Editar regra existente
  - Deletar regra (com confirmação)
  - Habilitar/desabilitar regra sem deletar

## Open Questions

- O editor interativo de regras deve usar o mesmo `ConsolePrompter` existente ou uma lib de menus mais rica (ex: `inquirer`)?
- Quando múltiplos orçamentos em paralelo usam o mesmo browser agent, há alguma limitação de concorrência? (ex: max N instâncias simultâneas)
- Regras `add-product` devem participar do loop de valor mínimo (bump) ou são apenas adicionadas como estão?

---

## Revisita: 2026-06-09

### Updated Problem Framing

O sistema de `override-discount` exige uma regra por produto para aplicar desconto por quantidade — impraticável quando a lógica de desconto é uniforme ("qualquer produto com >= X caixas recebe Y% de desconto"). Precisamos de um novo tipo de regra que aplique descontos automaticamente a qualquer produto do pedido com base na quantidade de caixas.

### New Approaches Considered

#### A: `threshold-discount` global por provider (Escolhido)
- Pros: Uma regra cobre todos os produtos; múltiplos níveis (tiers) por provider; semântica clara — regra de negócio não é por produto, é por volume
- Cons: Não permite threshold diferente por produto (considerado fora de escopo)

#### B: `threshold-discount` por produto específico
- Pros: Mais granular
- Cons: Retorna ao problema original (uma regra por produto); torna o schema mais complexo sem ganho real

#### C: Estender `override-discount` com campo de threshold
- Pros: Menos tipos novos
- Cons: Semântica confusa; `override-discount` hoje exige `product_code` específico; misturar conceitos seria tech debt

### Updated Decision

Novo tipo de regra `threshold-discount` com as seguintes características:

- **Escopo global por provider**: `product_code = '*'` (sentinel)
- **Threshold inclusivo**: produto com exatamente `quantity_value` caixas qualifica
- **Múltiplos tiers**: vários rows com `quantity_value` diferente são permitidos (UNIQUE constraint atualizada para incluir `quantity_value`)
- **Resolução de conflito**: quando múltiplos tiers são atendidos, aplica o maior `discount_pct`
- **Prioridade**: `override-discount` (produto específico) > `threshold-discount` > desconto automático da plataforma

Schema: tabela `product_rules` **resetada** (DROP + CREATE no constructor do repository). Sem migration.

Spec completo em: `docs/superpowers/specs/2026-06-09-threshold-discount-rule-design.md`

### Open Threads

- Tiers de threshold devem ser exibidos agrupados no log de início do run (ex: `DESCONTO POR QUANTIDADE: >=5 cx -> 10%, >=10 cx -> 15%`)
- O campo `quantity_unit` para `threshold-discount` é armazenado como `NULL`
