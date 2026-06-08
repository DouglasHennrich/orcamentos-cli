# Design — Agent Orçamento

**Data:** 2026-06-06
**Status:** Aprovado (aguardando revisão do spec)
**Local:** `do-yourself/agent-orcamento/`

## 1. Objetivo

Harness que gera orçamentos automaticamente em dois portais de fornecedores —
**Auto America** e **Roberlo** — a partir de um pedido em JSON. O harness resolve
os pseudo-nomes de produto para os produtos reais do portal, converte quantidades,
aplica as regras de negócio de cada plataforma e salva o orçamento.

## 2. Modelo de execução

Orquestrador **determinístico** em TypeScript (ESM, igual ao restante do projeto),
estilo *function-calling / typed flow* — **não** ReAct. O `agent-browser` CLI é o
**atuador web**, encapsulado em "page drivers" por plataforma. O provider LLM
Copilot existente permanece **fora do caminho crítico** (pode ser auxiliar futuro).

Fluxo macro:

```
JSON → validar → para cada produto: resolver (cache SQLite OU busca-ao-vivo + perguntar)
→ login → abrir orçamento → adicionar linhas (em unidades) → ler preços
→ loop de valor-mínimo → aplicar descontos → setar parcelas → salvar
```

Há **dois pontos de parada interativa** (human-in-the-loop):
1. **Produto não encontrado** → busca ao vivo no portal + usuário escolhe + persiste.
2. **Pedido abaixo do mínimo** → usuário escolhe qual(is) produto(s) aumentar.

## 3. Módulos (limites isolados)

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `cli/index.ts` | comando `run --platform <autoamerica\|roberlo> --order <file.json>`; fino | commander |
| `orcamento/order.ts` | schema Zod do JSON + parse de `"2 UN"`/`"4"` → `{value, unit}` (default CX) | zod |
| `platforms/<plat>.ts` | config: URL, constraints, funções puras `minOrderValue`, `computeParcelas(total)`, `computeDiscount(...)` | — |
| `db/alias-repository.ts` | SQLite: cache de correlações pseudo-nome → produto | node:sqlite |
| `orcamento/resolver.ts` | por linha: cache-hit OU busca-ao-vivo + pergunta + persiste; converte qtd → unidades | repo, driver, prompt |
| `platforms/driver.ts` (+ `autoamerica-driver.ts`, `roberlo-driver.ts`) | **action space** sobre agent-browser | child_process |
| `orcamento/orchestrator.ts` | sequencia todo o fluxo determinístico | todos acima |
| `io/prompt.ts` | prompts interativos (readline), stubável em testes | — |

Princípio de isolamento: cada módulo tem uma responsabilidade clara, interface
bem definida e é testável isoladamente. O driver recebe um `runCommand` injetável
para que testes stubem a saída do agent-browser sem abrir um browser real.

## 4. Entrada (JSON do pedido)

Conforme `resources/orcamento-template.md`:

```json
{
  "client": "028766370",
  "produtos": [
    { "name": "Produto A", "quantity": "2 UN" },
    { "name": "Produto B", "quantity": "4" }
  ]
}
```

- `client`: CNPJ ou nome do cliente.
- `quantity`: `"N UN"` (unidades) ou `"N CX"` / `"N"` (caixas — **default CX**).
- `quantity` ausente → produto sem quantidade informada (ver §7, loop de mínimo).

Validação via Zod; `quantity` parseado para `{ value: number, unit: 'UN' | 'CX' }`.

## 5. Banco de dados (SQLite — `node:sqlite`)

O seed `.js` (`resources/*-products.js`) **não** é fonte de verdade (pode estar
desatualizado). O DB é um **cache de correlações** construído incrementalmente a
partir de buscas **ao vivo** no portal.

```sql
CREATE TABLE aliases (
  platform      TEXT NOT NULL,    -- 'autoamerica' | 'roberlo'
  alias_norm    TEXT NOT NULL,    -- normalizado: minúsculo, sem acento, espaços colapsados
  alias_raw     TEXT NOT NULL,    -- como o usuário escreveu ("Produto A")
  product_code  TEXT NOT NULL,    -- "303535001"
  product_name  TEXT NOT NULL,    -- nome no portal no momento da resolução
  units_per_box INTEGER NOT NULL, -- unidades = 1 caixa (informado pelo usuário)
  created_at    TEXT NOT NULL,
  PRIMARY KEY (platform, alias_norm)
);
```

Lookup por `(platform, alias_norm)`. Lib: `node:sqlite` nativo (sem dependência
nativa a compilar).

## 6. Resolução de produto (regra "pausar e perguntar")

Para cada linha do pedido:

1. Normaliza `name` → busca em `aliases`.
   - **Hit** → usa `product_code` + `units_per_box`.
2. **Miss** → **PAUSA interativa**:
   - `driver.searchProducts(termos)` digita no dropdown do portal
     (select2 no Auto America, bootstrap-select no Roberlo) e lê as opções **ao vivo**.
   - `prompt` mostra os resultados; usuário escolhe o correto (ou redigita termos).
   - usuário informa **unidades por caixa** (`units_per_box`).
   - persiste em `aliases`; esse pseudo-nome nunca mais é perguntado.

### Conversão de quantidade (site trabalha em unidades)

O pedido fala em caixas, mas o **campo do site recebe unidades**:

- `CX` (ou sem unidade): `site_units = value × units_per_box`
- `UN`: `site_units = value`

Multiplicação exata — sem arredondamento.

## 7. Regras de negócio por plataforma

### Auto America
- **Tipo de orçamento:** Em elaboração
- **Tabela de preços:** 099 — POLIMENTO C5_12% SP-RS-MG-RJ
- **Transportadora:** EXPRESSO SAO MIGUEL LTDA · **Frete:** CIF
- **Valor mínimo do pedido (total):** R$ 2.500,00
- **Parcelas:** < 5k → 30/60 · < 10k → 30/60/90
- **Desconto:** 15% **por linha** cujo produto tenha **> 10 caixas**

### Roberlo
- **Tipo de orçamento:** Previsto
- **Transportadora:** TRANS-FACE TRANSPORTES LTDA (61683652000243) · **Frete:** CIF
- **Valor mínimo do pedido (total):** R$ 5.000,00
- **Parcelas:** < 10k → 30/60/90
- **Desconto:** máximo do campo `Desconto 02` (lido do portal); se `Desconto 02 == 0`,
  usar `Desconto 03` se existir.

### Loop de valor-mínimo (comum)
1. Quantidade informada → usa; não informada → começa em **1 caixa**.
2. Lê o total do pedido no portal.
3. Se `total < mínimo da plataforma` → **PAUSA interativa**: mostra os produtos e o
   total atual; o usuário escolhe **qual(is) produto(s) aumentar**. Incrementa
   **1 caixa por vez** (`units_per_box` unidades) e relê o total até `total ≥ mínimo`.
4. **Teto de iterações** como guarda contra loop infinito.

## 8. Action space do driver (agent-browser)

Tools tipadas, entradas estreitas, saída determinística no formato
`{ status: 'success' | 'warning' | 'error', summary, data?, next_actions? }`
(princípios de agent-harness-construction).

- `login()`
- `startQuote({ client, tipo, tabelaPrecos, transportadora, frete })`
- `searchProducts(terms) → { code, name }[]`
- `addLine(productCode, units)`
- `readLinePrice(productCode) → { unit, total }`
- `applyDiscount(productCode, pct)`
- `readOrderTotal() → number`
- `setParcelas(plan)`
- `save()`

Cada driver encapsula o churn de `snapshot -i` / `@eN` refs e os seletores,
**autorados inspecionando o portal ao vivo durante a implementação** (login com as
credenciais, snapshot de cada passo). Os portais são páginas `.apw` antigas.

## 9. Contrato de erro e recuperação

- **Produto não encontrado** → STOP interativo (§6); resultado persistido.
- **Pedido abaixo do mínimo** → STOP interativo (§7).
- **Falha de step no portal** (seletor ausente / timeout) → resultado de erro com
  causa-raiz + retry seguro (**re-snapshot 1×**) + stop após **N tentativas**,
  salvando o último snapshot como artefato de debug.
- **Mapeamento do fluxo:** ao autorar os drivers, se um elemento não for encontrado
  de forma confiável, **PARAR e pedir ajuda ao usuário** — não entrar em loop de
  tentativas. (Preferência explícita do usuário.)
- **Loop de valor-mínimo** com teto de iterações.

## 10. Segurança

As credenciais dos portais estão em **texto puro** em `resources/auto-america.md`
e `resources/roberlo.md` (commitadas). **Ação:** mover para `.env` (dotenv já é
dependência) e remover dos `.md`. Variáveis: `AUTOAMERICA_USER/PASS`,
`ROBERLO_USER/PASS`.

## 11. Testes (vitest, já configurado)

- **Unit (funções puras):** parser do pedido, conversão de quantidade, cálculo de
  desconto, seleção de parcelas, loop de valor-mínimo.
- **Repositório:** contra arquivo SQLite temporário.
- **Driver:** `runCommand` injetável → testes stubam a saída do agent-browser.

## 12. CLI

```
agent-orcamento run --platform <autoamerica|roberlo> --order ./pedido.json
```

Variáveis de ambiente carregadas via `.env`.

## 13. Decisões resolvidas

| Item | Decisão |
|---|---|
| Modelo de execução | Determinístico + agent-browser; LLM fora do crítico |
| Escopo de automação | Completo: lê preços, aplica regras, salva o orçamento |
| Resolução de produto | Busca **ao vivo** no portal + usuário escolhe + persiste |
| units_per_box | Usuário informa ao resolver |
| Sentido da conversão | Caixas (JSON) → unidades (site) = `value × units_per_box` |
| Mínimo | Sobre o **total** do pedido (AA 2.500 / Roberlo 5.000) |
| Múltiplo do loop | 1 caixa por incremento |
| Abaixo do mínimo | Perguntar ao usuário quais produtos aumentar |
| Lib SQLite | `node:sqlite` nativo |
| Credenciais | `.env` (removidas dos `.md`) |
