# Roteiro de Faturamento — Auto America

**Portal:** `https://representante.autoamerica.com.br:5100/portal/`  
**Credenciais:** `.env` → `AUTOAMERICA_USER` / `AUTOAMERICA_PASS`

---

## 1. Login

**URL:** `U_PortalLogin.apw`

| Campo | Selector / ID | Valor |
|-------|--------------|-------|
| Usuário | `input[type="text"]` (primeiro) | `AUTOAMERICA_USER` |
| Senha | `input[type="password"]` (primeiro) | `AUTOAMERICA_PASS` |
| Botão | `button` (primeiro) | click |

Após login → redireciona para menu principal.

---

## 2. Abrir formulário de novo orçamento

1. Navegar para `U_OrcLst.apw`
2. Clicar em botão "Novo Orçamento"
3. Modal "Filial Para Orçamento" aparece → clicar **OK** (filial padrão `010101`)
4. Formulário abre em `u_AddOrc.apw`

---

## 3. Preencher cabeçalho do orçamento

Todos os campos são dropdowns select2 controlados via jQuery.

| Campo | Select ID | Valor a setar | Observação |
|-------|-----------|--------------|------------|
| Cliente | `CJ_CLIENTE` | option value = CNPJ sem máscara + `0001` (ex: `0287663700001`) | 516 opções pré-carregadas |
| Tabela de Preços | `CJ_TABELA` | `099` | `099 - POLIMENTO C5_12% SP-RS-MG-RJ` |
| Tipo de Orçamento | `CJ_XTPORC` | `3` | `3 = Em elaboração`, `1 = Previsto`, `2 = Firme` |
| Tipo de Frete | `CJ_TPFRETE` | `C` | `C = CIF` |
| Transportadora | `CJ_XTRANSP` | `000157` | `000157 = EXPRESSO SAO MIGUEL LTDA` |
| Condição de Pagamento | `CJ_CONDPAG` | `031` ou `032` | `031 = 30/60`, `032 = 30/60/90` (setada ao final) |

**Snippet para buscar cliente por CNPJ:**
```js
var opt = Array.from(document.getElementById('CJ_CLIENTE').options)
  .find(o => o.text.includes('028766370'));
// opt.value = '0287663700001'
jQuery('#CJ_CLIENTE').val(opt.value).trigger('change');
```

**Snippet para setar todos os campos fixos:**
```js
jQuery('#CJ_XTPORC').val('3').trigger('change');   // Em elaboração
jQuery('#CJ_TABELA').val('099').trigger('change');
jQuery('#CJ_TPFRETE').val('C').trigger('change');   // CIF
jQuery('#CJ_XTRANSP').val('000157').trigger('change'); // EXPRESSO SAO MIGUEL
```

---

## 4. Itens do orçamento

### 4.1. Campos por item (padrão `NN` = número 2 dígitos: 01, 02, …)

| Campo | ID | Tipo | Observação |
|-------|-----|------|------------|
| Produto | `CK_PRODUTO{NN}` | select2 | 280 opções pré-carregadas; value = código do produto |
| Quantidade | `CK_QTDVEN{NN}` | text (enabled) | Unidades (não caixas) |
| Preço base | `CK_XPRCBAS{NN}` | text (disabled) | Vlr Conversor |
| Preço tabela | `CK_PRCVEN{NN}` | text (disabled) | Vlr de Tabela |
| Preço c/ impostos | `CK_XPRCIMP{NN}` | text (disabled) | Vlr c/ Impostos (por unidade, após desconto) |
| % Desconto | `CK_DESCONT{NN}` | text (disabled no HTML) | Precisa `removeAttribute('disabled')` antes de setar |
| Total da linha | `CK_VALOR{NN}` | text (disabled) | Vlr Total da linha |

### 4.2. Adicionar item

```js
// Para item 01 (já existe na carga da página):
jQuery('#CK_PRODUTO01').val('303535001').trigger('change');

// Para itens 02, 03, ...: clicar primeiro em "Novo Item"
document.getElementById('btAddItm').click();
// aguardar CK_PRODUTO02 aparecer no DOM
jQuery('#CK_PRODUTO02').val('303535004').trigger('change');
```

### 4.3. Setar quantidade e recalcular preço

```js
var n = '01'; // número do item
document.getElementById('CK_QTDVEN' + n).value = '12';
VldValor(n); // recalcula Vlr c/ Impostos, % Desconto e Vlr Total
```

### 4.4. Aplicar desconto por linha (> 10 caixas → 15%)

```js
var n = '01';
var d = document.getElementById('CK_DESCONT' + n);
d.removeAttribute('disabled');
d.value = '15,00'; // vírgula como separador decimal
VldValor(n);        // recalcula totais
```

### 4.5. Buscar produtos por termo

```js
var terms = 'brilho';
var opts = Array.from(document.getElementById('CK_PRODUTO01').options)
  .filter(o => o.value && o.text.toLowerCase().includes(terms))
  .map(o => ({code: o.value, name: o.text}));
// ex: [{code: '303535001', name: '303535001 - BRILHO RAP S/SIL MOTHERS 473ML'}]
```

---

## 5. Totais do orçamento

| Campo | ID | Descrição |
|-------|-----|-----------|
| Total de itens | `TOTAL_QITENS` | Quantidade total |
| Base | `TOTAL_ITENS` | Valor base (sem impostos) |
| Impostos | `TOTAL_IMP` | Total IPI |
| **Total do pedido** | **`TOTAL_ORC`** | **Valor total (referência para mínimo e parcelas)** |

```js
// Ler total
var totalStr = document.getElementById('TOTAL_ORC').value; // ex: "426,13"
var total = parseFloat(totalStr.replace(/\./g,'').replace(',','.'));
```

---

## 6. Regras de negócio

| Regra | Valor |
|-------|-------|
| Valor mínimo do pedido | R$ 2.500,00 (leia `TOTAL_ORC`) |
| Desconto por linha | 15% se produto > 10 caixas |
| Parcelas `CJ_CONDPAG` | `031` se total < R$5.000; `032` se total < R$10.000 |
| Modalidade pagamento | BOLETO BANCARIO (padrão — não alterar) |

---

## 7. Salvar orçamento

```js
document.getElementById('btSalvar').click();
// aguardar networkidle — página recarrega com PR= na URL
```

Após salvar, a página permanece no formulário do mesmo orçamento (com `PR=` na URL contendo o ID codificado em base64). Os dados são preservados.

---

## 8. Fluxo completo resumido

```
1. navigate U_PortalLogin.apw
2. eval: preencher usuário + senha + clicar botão login
3. wait networkidle
4. navigate U_OrcLst.apw
5. eval: clicar "Novo Orçamento"
6. wait networkidle
7. eval: clicar OK no modal de filial
8. wait networkidle
9. eval: setar CJ_CLIENTE, CJ_XTPORC, CJ_TABELA, CJ_TPFRETE, CJ_XTRANSP
10. Para cada produto:
    a. eval: btAddItm.click() (se item > 01)
    b. eval: jQuery('#CK_PRODUTO0N').val(code).trigger('change')
    c. eval: CK_QTDVEN0N.value = units; VldValor('0N')
11. eval: ler TOTAL_ORC
12. Se total < 2500: loop de incremento (pedir ao usuário)
13. Para cada linha com > 10 caixas:
    eval: CK_DESCONT0N.removeAttribute('disabled'); value = '15,00'; VldValor('0N')
14. eval: ler TOTAL_ORC (após descontos)
15. eval: jQuery('#CJ_CONDPAG').val('031' ou '032').trigger('change')
16. eval: btSalvar.click()
17. wait networkidle
```
