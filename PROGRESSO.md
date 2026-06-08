# Progresso — agent-orcamento

**Projeto:** `do-yourself/agent-orcamento/`  
**Branch:** `feat/agent-orcamento`  
**Última atualização:** 2026-06-06

---

## Status geral das tarefas

| # | Tarefa | Status | Notas |
|---|--------|--------|-------|
| 0–10 | Core (order, quantity, db, resolver, orchestrator, etc.) | ✅ Concluído | Testes passando |
| 11 | Auto America driver (live mapping) | ✅ Concluído | Ver detalhes abaixo |
| 12 | Roberlo driver (live mapping) | ✅ Concluído | Ver detalhes abaixo |
| 13 | Product resolver | ✅ Concluído | |
| 14 | Orchestrator | ✅ Concluído | |
| 15 | CLI `run` command | ✅ Concluído | |
| 16 | Full verification (`pnpm test && pnpm build && pnpm lint`) | ⏳ Pendente | |

---

## Task 11 — Auto America driver ✅

**Arquivo criado:** `src/platforms/autoamerica-driver.ts`

### Mapeamento de campos (resultado do live mapping com browser headed)

**Cabeçalho do orçamento:**
- Cliente: `CJ_CLIENTE` (select2, 516 opções, value = CNPJ sem máscara + "0001")
  - Ex: CNPJ "028766370" → option value "0287663700001"
- Tipo de Orçamento: `CJ_XTPORC` (value `3` = Em elaboração)
- Tabela de Preços: `CJ_TABELA` (value `099` = POLIMENTO C5_12% SP-RS-MG-RJ)
- Tipo de Frete: `CJ_TPFRETE` (value `C` = CIF)
- Transportadora: `CJ_XTRANSP` (value `000157` = EXPRESSO SAO MIGUEL LTDA)
- Condição de Pagamento: `CJ_CONDPAG` (value `031` = 30/60 | `032` = 30/60/90)
  - Modalidade sempre BOLETO BANCARIO (padrão — não alterar)

**Itens (padrão NN = 2 dígitos: 01, 02, ...):**
- Produto: `CK_PRODUTO{NN}` (select2, **280 opções pré-carregadas** — set via jQuery val)
- Quantidade: `CK_QTDVEN{NN}` (text input, enabled)
- Preço c/ impostos (unit): `CK_XPRCIMP{NN}` (disabled, calculado)
- Desconto %: `CK_DESCONT{NN}` (disabled no HTML → precisa `removeAttribute('disabled')`)
- Total da linha: `CK_VALOR{NN}` (disabled)

**Totais:**
- Total do pedido: `TOTAL_ORC` (disabled input — referência para regras de mínimo e parcelas)

**Botões:**
- Novo Item: `btAddItm` (click via JS)
- Salvar: `btSalvar` (click via JS)

**Função de recálculo:** `VldValor('NN')` — deve ser chamada após setar qty ou discount.

### Roteiro completo
Ver `resources/auto-america-roteiro.md` para snippets JS detalhados.

---

## Task 12 — Roberlo driver ✅

**Arquivo criado:** `src/platforms/roberlo-driver.ts`

### Mapeamento de campos (resultado do live mapping com browser headed)

**Navegação (CRÍTICO — manter sessão):**
- Login: navegar diretamente para `http://52.67.57.130/portal/U_PortalLogin.apw`
- Novo orçamento: **NÃO navegar por URL** → usar JS click em âncora `'Orçamento de Venda'`
  - Motivo: navegação direta perde token de sessão e redireciona para login

**Cabeçalho do orçamento:**
- Cliente: `CJ_CLIENTE` (select, busca por CNPJ/nome em `o.text.includes(term)`)
- Tipo de Orçamento: `CJ_XTPORC` (value `'2'` = Previsto)
- Tipo de Frete: `CJ_TPFRETE` (value `'C'` = CIF)
- Transportadora: `CJ_XTRANSP` (value `'000293'` = TRANS-FACE 61683652000243)
- Condição de Pagamento: `CJ_CONDPAG` (value `'031'` = 30/60, `'032'` = 30/60/90)

**Itens (padrão NN = 2 dígitos: 01, 02, ...):**
- Seleção de tabela: `CK_XTABELA{NN}` (select — **obrigatório antes do produto**)
- Produto: `CK_PRODUTO{NN}` (select, carrega após tabela selecionada)
- Quantidade: `CK_QTDVEN{NN}` (disabled → precisa `removeAttribute('disabled')`)
- Total linha: `CK_VALOR{NN}`, preço unit: `CK_XPRCIMP{NN}`

**Totais:**
- Total do pedido: `TOTAL_ORC` (referência para mínimo e parcelas)

**Botões:**
- Novo Item: `btAddItm`
- Salvar: `btSalvar`

**Fluxo de desconto (2 modais):**
1. Modal informativo: `detalheOrc('NN')` → ler `% Desconto 2` e `% Desconto 3` (labels em `.modal.in`)
   - Fechar: `.bootbox-close-button`
2. Modal aplicar: `descPolimento('NN')` → campo `iCK_XDESC02{NN}` ou `iCK_XDESC03{NN}`
   - `% Desconto 2 > 0` → aplicar em `iCK_XDESC02{NN}` (habilitado por padrão)
   - `% Desconto 3 > 0` → `iCK_XDESC03{NN}` (disabled por padrão — removeAttribute + disabled=false)
   - **CRÍTICO — formato do valor**: portal espera inteiro × 100 → `15%` = `"1500"` (não `"15,00"`)
   - Função de recálculo: `vldDesc('NN')`
   - Confirmar: `button[data-bb-handler="sucess"]`

**Problema ERR_BLOCKED_BY_CLIENT:**
- Chrome HTTPS-First mode bloqueia `http://52.67.57.130`
- Solução: rodar em `--headed` e usuário clica "Ir para o site" no modal de segurança
- Flags `--disable-features=HttpsUpgrades,HttpsFirstModeV2` causam `ERR_TOO_MANY_REDIRECTS`
- Modo headless causa "Multiple targets not supported in headless mode"

---

## Task 15 — CLI `run` command ✅

**Arquivo a criar:** `src/cli/index.ts`

```
agent-orcamento run --platform <autoamerica|roberlo> --order ./pedido.json
```

- Carregar .env (dotenv)
- Parsear order JSON (parseOrder)
- Instanciar AliasRepository (caminho do DB)
- Instanciar ConsolePrompter
- Instanciar driver correto (AutoAmericaDriver ou RoberloDriver)
- Chamar runOrcamento(...)

---

## Task 16 — Full verification ⏳

```bash
pnpm test        # vitest — todos os testes co-localizados em src/
pnpm build       # tsc — build ESM
pnpm lint        # eslint
```

Possíveis ajustes necessários:
- Tipos TypeScript no driver (exactOptionalPropertyTypes)
- Import paths com `.js` extension

---

## Erros conhecidos / correções anteriores

1. **Test file no diretório errado** (task 1): arquivo de test foi criado em `tests/` em vez de `src/` (co-localizado). Corrigido movendo para `src/orcamento/order.test.ts` e atualizando vitest.config.ts.

2. **vi.fn() type inference** (task 13): `vi.fn().mockResolvedValueOnce(null)` inferia `undefined` mas o tipo esperava `ProductOption | null`. Corrigido com cast explícito `as ProductOption | null`.

3. **exactOptionalPropertyTypes** (task 14): `tabelaPrecos: platform.tabelaPrecos` (string|undefined) não era atribuível a propriedade opcional. Corrigido com spread condicional: `...(platform.tabelaPrecos !== undefined ? { tabelaPrecos: platform.tabelaPrecos } : {})`.

4. **Refs mudam após fechar/reabrir browser**: Após `--headed`, refs do snapshot mudam. Sempre re-snapshot antes de usar refs.

5. **Roberlo desconto — formato do valor** (task 12): Portal espera inteiro × 100 para percentual. `15%` → `"1500"` (não `"15,00"`). Corrigido com `String(Math.round(pct * 100))` em `roberlo-driver.ts:applyDiscount`.

6. **Roberlo desconto — campo iCK_XDESC03 bloqueado** (task 12): `disabled=""` é atributo HTML mas pode ser reativado por JS. Correção: `removeAttribute('disabled')` + `d3.disabled = false` + `removeAttribute('readonly')` + dispatch de `input`/`change` antes de `vldDesc`.

---

## Próximos passos (continuar de outra sessão)

1. **Abrir o browser headed** para o portal Roberlo e mapear o formulário (Task 12).
   - Credenciais em `.env` como `ROBERLO_USER` e `ROBERLO_PASS`
   - Usar `agent-browser` com flag `--headed`
   - Se elemento não encontrado: PARAR e perguntar ao usuário (nunca fazer loop)

2. **Implementar `src/platforms/roberlo-driver.ts`** com base no mapeamento.
   - Desconto é lido do portal (Desconto 02 → Desconto 03 fallback), não calculado
   - Método extra: `readMaxDiscount(productCode)` (acessado via duck-typing no orchestrator)

3. **Implementar `src/cli/index.ts`** (Task 15).

4. **Rodar `pnpm test && pnpm build && pnpm lint`** e corrigir erros (Task 16).

5. **Commit final** e PR.
