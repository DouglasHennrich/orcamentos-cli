# Documentação Técnica dos Portais Auto America e Roberlo

> Leitura obrigatória antes de escrever qualquer código de automação para esses portais.
> Tudo aqui foi descoberto empiricamente — não presuma comportamento padrão web; leia cada seção.

---

## Visão Geral

Ambos os portais rodam no mesmo sistema legado (Protheus/TOTVS) com front-end em jQuery. A
arquitetura é idêntica: páginas `.apw` com formulários de itens repetíveis (`01`, `02`, ...,
`NN`), comunicação via AJAX síncrono (`async: false`) para endpoints `.apw`, e manipulação de DOM
via jQuery e funções globais JavaScript.

| Aspecto | Auto America | Roberlo |
|---|---|---|
| URL base | `https://representante.autoamerica.com.br:5100/portal/` | `http://52.67.57.130/portal/` |
| Login | `U_PortalLogin.apw` | `U_PortalLogin.apw` |
| Orçamento | `u_AddOrc.apw` | `u_AddOrc.apw` |
| Tabela de preços | Global (`CJ_TABELA`) | Por linha (`CK_XTABELA{NN}`) |
| Pedido mínimo | R$ 2.500 | R$ 5.000 |
| Tabela padrão | `099 - POLIMENTO C5_12% SP-RS-MG-RJ` | Primeira disponível |

---

## Sessão e Token PR

Ambos os portais usam um token de sessão chamado `PR` embutido na URL da página atual (query
string). Ele é necessário para chamadas AJAX diretas a endpoints `.apw`.

```javascript
// Ler o token PR da página atual
const pr = new URLSearchParams(location.search).get('PR') || '';

// Usar em chamadas AJAX
const url = 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : '');
```

**Nunca navegue para URLs com o token PR hardcoded.** Use sempre links do menu ou cliques em
botões para preservar a sessão. Navegar diretamente para `u_AddOrc.apw` sem o PR correto resulta
em erro 500 ou redirecionamento para login.

**Detecção de sessão expirada:** Se qualquer resposta AJAX contiver `<META HTTP-EQUIV`, a sessão
expirou. O portal faz `$("html").html(data)` ao detectar isso — substituindo toda a página pela
tela de login. Sempre verifique antes de processar a resposta:

```javascript
if (!data || data.toUpperCase().indexOf('<META HTTP-EQUIV') >= 0) return; // sessão expirada
```

---

## ARMADILHA CRÍTICA: jQuery `.trigger('change')` vs. `dispatchEvent`

Esta é a armadilha mais importante dos portais. **Entenda bem antes de qualquer automação.**

Os campos do formulário têm handlers de evento registrados de duas formas diferentes:

| Forma | Exemplo no HTML | Disparado por `.trigger('change')` | Disparado por `dispatchEvent` |
|---|---|---|---|
| Atributo nativo `onchange` | `onchange="gatProduto($(this))"` | ❌ NÃO | ✅ SIM |
| Handler jQuery registrado | `$(el).on('change', fn)` | ✅ SIM | ✅ SIM |

**`jQuery('.trigger('change')` SÓ dispara handlers registrados via jQuery.** Não dispara
handlers definidos como atributo HTML (`onchange="..."`).

```javascript
// ERRADO — não dispara onchange="gatProduto($(this))"
jQuery('#CK_PRODUTO01').val('123456').trigger('change');

// CERTO — dispara qualquer handler, incluindo atributo nativo
const el = document.getElementById('CK_PRODUTO01');
el.value = '123456';
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**Exceção importante:** Para campos cujo `onchange` faz AJAX perigoso (ver `gatProduto` abaixo),
NÃO use `dispatchEvent`. Use a chamada AJAX direta ao endpoint (ver seção Unidades por Caixa).

---

## Estrutura do Formulário de Orçamento (`u_AddOrc.apw`)

### Campos do cabeçalho (CJ_*)

| ID do campo | Descrição | Observações |
|---|---|---|
| `CJ_CLIENTE` | Select do cliente | Valor = código interno, não CNPJ |
| `CJ_TABELA` | Select da tabela de preços | **Auto America apenas** — global para todos os itens |
| `CJ_CONDPAG` | Select da condição de pagamento | Ver códigos abaixo |
| `CJ_XTPORC` | Tipo de orçamento | AA: `'3'` = Em Elaboração; Roberlo: `'2'` = Previsto |
| `CJ_TPFRETE` | Tipo de frete | `'C'` = CIF |
| `CJ_XTRANSP` | Código da transportadora | Valor numérico interno (ex: `'000157'`) |
| `TOTAL_ORC` | Total do orçamento | Campo calculado, lido após operações |

### Campos por linha (CK_*{NN})

`NN` = número da linha com zero à esquerda: `01`, `02`, `03`, ...

| ID do campo | Descrição | Observações |
|---|---|---|
| `CK_XTABELA{NN}` | Select da tabela de preços | **Roberlo apenas** — específico por linha |
| `CK_PRODUTO{NN}` | Select do produto | Opções carregadas via `selProd()` (AA) ou troca de tabela (Roberlo) |
| `CK_QTDVEN{NN}` | Quantidade em unidades | Roberlo: começa `disabled` — remover atributo antes de preencher |
| `CK_XPRCIMP{NN}` | Preço unitário | Preenchido por `gatProduto()` via AJAX |
| `CK_VALOR{NN}` | Valor total da linha | Calculado por `VldValor(NN)` |
| `CK_DESCONT{NN}` | Desconto % (Auto America) | `disabled` por padrão — remover antes de preencher |
| `QTD_EMB{NN}` | Quantidade de embalagem (unidades/caixa) | Preenchido por `gatProduto()` via AJAX |

### Botões de ação

| ID / seletor | Ação |
|---|---|
| `#btAddItm` | Adiciona nova linha de item |
| `#btSalvar` | Salva o orçamento |
| `button[text*='Novo Or']` | Abre formulário de novo orçamento |
| `button[text='OK']` | Confirma modal (filial, etc.) |

---

## Funções JavaScript Globais do Portal

Estas funções existem no escopo global da página. **Não as reimplemente — chame diretamente.**

### `selProd()` — Auto America apenas

Carrega as opções de produto no select `CK_PRODUTO01` com base em `CJ_TABELA` e `CJ_CLIENTE`.
Usa AJAX síncrono. Deve ser chamada após definir tabela e cliente.

```javascript
jQuery('#CJ_TABELA').val('099');
selProd(); // popula CK_PRODUTO01 com ~280 opções
```

### `SelCliente()` — Auto America apenas

Disparada ao mudar `CJ_CLIENTE`. Faz AJAX assíncrono para carregar as tabelas de preços
disponíveis para o cliente em `CJ_TABELA`. Aguarde o `CJ_TABELA` ter mais de 1 opção antes de
prosseguir (até 10 segundos).

### `gatProduto(objInput)` — Ambos os portais

Disparada pelo `onchange` nativo de `CK_PRODUTO{NN}`. Faz chamada AJAX assíncrona para
`U_GATPROD.APW` e preenche os campos da linha: preço (`CK_XPRCIMP{NN}`), quantidade de embalagem
(`QTD_EMB{NN}`), e outros.

**PERIGO:** O handler de sucesso do AJAX faz `$("html").html(data)` se a sessão expirar —
substituindo toda a página pelo login. **Nunca confie no tempo de resposta desta função para ler
`QTD_EMB{NN}` após dispará-la.**

**Solução:** Chame `U_GATPROD.APW` diretamente com `async: false` (ver seção Unidades por Caixa).

### `VldValor(NN)` — Ambos os portais

Recalcula o valor total da linha `NN` (`CK_VALOR{NN}`) com base em preço e quantidade. Deve ser
chamada após definir `CK_QTDVEN{NN}`.

### `VldQtd(NN)` — Ambos os portais

Valida que a quantidade em `CK_QTDVEN{NN}` é múltipla de `QTD_EMB{NN}`. Se não for, exibe
`bootbox.alert("A quantidade deve ser múltiplo de " + nQtdEmb + ".")`.

### `detalheOrc(NN)` — Roberlo

Abre modal com detalhes do item `NN`, incluindo os descontos máximos disponíveis (`% Desconto 2`,
`% Desconto 3`). Aguarde ~400ms após chamar antes de ler o modal.

### `descPolimento(NN)` — Roberlo

Abre modal para aplicar desconto no item `NN`. Campos: `iCK_XDESC02{NN}` e `iCK_XDESC03{NN}`.
Valor em "basis points × 100": 15% → `"1500"`. Confirmar com
`button[data-bb-handler="sucess"]` (typo original do portal).

### `vldDesc(NN)` — Roberlo

Recalcula desconto e valor após alterar campos de desconto.

---

## Endpoint AJAX: `U_GATPROD.APW`

O endpoint central para dados de produto. Retorna JSON com informações completas do produto.

### Requisição

```
POST U_GATPROD.APW?PR={token}
Content-Type: application/x-www-form-urlencoded

produto=304535001&tabela=099&cliente=001234&descvista=0&descretir=0&descredesp=0&valfrete=0
```

| Parâmetro | Descrição |
|---|---|
| `produto` | Código do produto (valor do option em `CK_PRODUTO{NN}`) |
| `tabela` | Código da tabela de preços (valor de `CJ_TABELA` ou `CK_XTABELA{NN}`) |
| `cliente` | Código do cliente (valor de `CJ_CLIENTE`) |
| `descvista`, `descretir`, `descredesp`, `valfrete` | Sempre `0` para consulta |

### Resposta

```json
{
  "erro": false,
  "quantidadeembalagem": 12,
  "preco": "45,00",
  "desconto": "0,00"
}
```

| Campo | Descrição |
|---|---|
| `erro` | `true` se produto não encontrado ou erro |
| `quantidadeembalagem` | **Unidades por caixa** — o que precisamos para auto-detectar |
| `preco` | Preço unitário em formato BRL |

### Como chamar corretamente

```javascript
(function() {
  var pr = new URLSearchParams(location.search).get('PR') || '';
  var result = '';
  jQuery.ajax({
    type: 'POST',
    url: 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : ''),
    data: {
      produto:    '304535001',
      tabela:     jQuery('#CJ_TABELA').val() || '',   // AA: global; Roberlo: CK_XTABELA01
      cliente:    jQuery('#CJ_CLIENTE').val() || '',
      descvista:  0, descretir: 0, descredesp: 0, valfrete: 0
    },
    async: false,
    success: function(data) {
      if (!data || data.toUpperCase().indexOf('<META HTTP-EQUIV') >= 0) return;
      try {
        var oRet = JSON.parse(data);
        if (!oRet.erro) result = String(oRet.quantidadeembalagem ?? '');
      } catch(e) {}
    }
  });
  return result;
})()
```

---

## Auto-detecção de Unidades por Caixa

Esta foi a descoberta mais importante do projeto. O portal conhece a quantidade de unidades por
caixa de cada produto — não há necessidade de perguntar ao usuário.

### Por que não usar `gatProduto()` + polling de `QTD_EMB{NN}`

1. `gatProduto()` é disparada por `onchange` nativo — `jQuery.trigger('change')` não a dispara.
2. Usar `dispatchEvent` para disparar `gatProduto()` funciona, mas a função faz AJAX **assíncrono**
   — você não sabe quando o campo `QTD_EMB{NN}` será preenchido.
3. Se a sessão expirar durante o AJAX, `gatProduto()` substitui **toda a página** pelo login,
   sem possibilidade de recuperação no mesmo contexto.

### Solução: chamar `U_GATPROD.APW` diretamente

Mesma chamada que `gatProduto()` faz internamente, mas com `async: false`. Retorna
`quantidadeembalagem` de forma síncrona e segura.

**Auto America:** tabela vem de `jQuery('#CJ_TABELA').val()` — global.

**Roberlo:** tabela vem de `jQuery('#CK_XTABELA01').val()` — específica da linha. É necessário
ter uma tabela selecionada (a que corresponde ao produto) antes de chamar. O cache
`productTabela` (mapa `productCode → tabelaCode`) é preenchido durante `searchProducts` e deve
ser consultado primeiro.

---

## Carregamento de Produtos

### Auto America

Os produtos são **pré-carregados** no select `CK_PRODUTO01` (tipicamente ~280 opções) pela função
`selProd()`, chamada durante `startQuote`. A busca é feita **client-side** por `.filter()` nas
opções já carregadas.

```javascript
// Busca client-side — sem AJAX
Array.from(document.getElementById('CK_PRODUTO01').options)
  .filter(o => o.value && o.text.toLowerCase().includes(termos))
  .slice(0, 20)
  .map(o => ({ code: o.value, name: o.text }))
```

Não há endpoint de busca de produto. Tudo que existe está no select.

### Roberlo

Os produtos **não são pré-carregados globalmente**. Cada tabela (`CK_XTABELA01`) tem seu próprio
conjunto de produtos. Para buscar, é necessário:

1. Iterar por cada opção de `CK_XTABELA01`
2. Selecionar a tabela via `.trigger('change')` e aguardar ~300ms (AJAX assíncrono carrega produtos)
3. Filtrar as opções de `CK_PRODUTO01` para aquela tabela
4. Acumular resultados, registrando qual tabela contém cada produto

```javascript
// Roberlo: busca cross-tabela
for (const tabela of tabelasDisponiveis) {
  jQuery('#CK_XTABELA01').val(tabela).trigger('change');
  await sleep(300); // aguarda carregamento de produtos
  // filtrar CK_PRODUTO01.options e registrar productTabela[productCode] = tabela
}
```

O mapa `productCode → tabelaCode` deve ser mantido em memória para uso posterior em `addLine` e
`readUnitsPerBox`.

---

## Fluxo de Início de Orçamento

### Auto America

```
1. Navegar via link do menu (a[href*="U_orcamento.apw"]) — preserva sessão PR
2. Clicar em "Novo Orçamento"
3. Confirmar modal de filial (clicar OK)
4. Definir CJ_CLIENTE → chamar SelCliente() → aguardar CJ_TABELA ter >1 opção (até 10s)
5. Definir CJ_TABELA → chamar selProd() → aguardar CK_PRODUTO01 ter >1 opção (até 10s)
6. Definir CJ_XTPORC = '3', CJ_TPFRETE = 'C', CJ_XTRANSP = '{código}'
```

**Busca do cliente:** O portal armazena CNPJ como `"027980912/0001 - NOME"` (9 dígitos com
barra). Para encontrar um cliente por CNPJ, compare os primeiros 8 dígitos (raiz) com o texto
da opção, ignorando formatação:

```javascript
var termRoot = cnpj.replace(/[^0-9]/g, '').substring(0, 8);
Array.from(document.getElementById('CJ_CLIENTE').options)
  .find(o => o.text.replace(/[^0-9]/g, '').includes(termRoot));
```

### Roberlo

```
1. Navegar via click em link do menu (a[text*="Orçamento de Venda"]) — preserva sessão
2. Clicar em "Novo Orçamento"
3. Definir CJ_CLIENTE via jQuery trigger('change')
4. Definir CJ_XTPORC = '2', CJ_TPFRETE = 'C', CJ_XTRANSP = '{código}'
5. NÃO há chamada equivalente a SelCliente() ou selProd() — produtos carregados por tabela
```

**Nota Roberlo:** Não há equivalente ao `CJ_TABELA` global. Cada linha tem seu próprio
`CK_XTABELA{NN}`. O jQuery `.trigger('change')` neste campo dispara AJAX que carrega produtos
(este é um handler jQuery — funciona com `.trigger()`).

---

## Adicionando Linhas ao Orçamento

### Sequência de campos a preencher

```
1. Clicar #btAddItm (se não for a primeira linha) → aguardar CK_PRODUTO{NN} existir
2. [Roberlo] Selecionar CK_XTABELA{NN} com a tabela correta → aguardar 300ms
3. Definir CK_PRODUTO{NN}.value = productCode (não dispara nada — preço vem de gatProduto)
4. Remover disabled de CK_QTDVEN{NN} se necessário (Roberlo)
5. Definir CK_QTDVEN{NN}.value = unidades
6. dispatchEvent(new Event('change', {bubbles:true})) em CK_QTDVEN{NN}
7. Chamar VldValor('{NN}')
```

**Problema conhecido:** Definir `CK_PRODUTO{NN}` via `.val()` sem chamar `gatProduto()` significa
que `CK_XPRCIMP{NN}` não é preenchido pelo portal. O campo de preço ficará vazio e `TOTAL_ORC`
permanecerá em 0. Para que o total seja calculado corretamente, é necessário garantir que
`gatProduto()` seja chamado para cada linha (ou que o preço seja preenchido de outra forma).

---

## Leitura de Preços e Total

| Campo | Como ler |
|---|---|
| Preço unitário de uma linha | `document.getElementById('CK_XPRCIMP{NN}')?.value` — formato BRL (`"45,00"`) |
| Total da linha | `document.getElementById('CK_VALOR{NN}')?.value` — formato BRL |
| Total do orçamento | `document.getElementById('TOTAL_ORC')?.value` — formato BRL |

Para converter BRL para número:
```javascript
function parseBRL(s) {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}
```

---

## Descontos

### Auto America

Desconto por volume: `> 10 caixas` → 15%. Campo `CK_DESCONT{NN}` começa `disabled`.

```javascript
var d = document.getElementById('CK_DESCONT01');
d.removeAttribute('disabled');
d.value = '15,00'; // vírgula como separador decimal
VldValor('01');
```

### Roberlo

Desconto lido da modal de detalhe (`detalheOrc(NN)`). Prioridade: `% Desconto 2` > `% Desconto 3`.
Aplicado via `descPolimento(NN)` nos campos `iCK_XDESC02{NN}` ou `iCK_XDESC03{NN}`.

**Formato do valor:** inteiro em "basis points × 100" — 15% → `"1500"`.

**Atenção:** `iCK_XDESC03{NN}` pode ser desativado tanto via atributo HTML `disabled` quanto via
propriedade JS `el.disabled = true`. Para habilitar:
```javascript
d3.removeAttribute('disabled');
d3.disabled = false;
```

---

## Condições de Pagamento

### Auto America

| Label | Código `CJ_CONDPAG` |
|---|---|
| `30/60` | `'031'` |
| `30/60/90` | `'032'` |

Regra: total < R$ 5.000 → `30/60`; total ≥ R$ 5.000 → `30/60/90`.

### Roberlo

| Label | Código `CJ_CONDPAG` |
|---|---|
| `30/60` | `'031'` |
| `30/60/90` | `'032'` |

Regra: sempre `30/60/90`.

---

## Condições de Pagamento do `agent-browser eval`

Quando se usa o CLI `agent-browser eval`, o valor de retorno é serializado como JSON. Strings
retornam com aspas duplas ao redor — é necessário fazer `JSON.parse()` para recuperar o valor real:

```
agent-browser eval "document.title"
# stdout: "Portal de Vendas"  ← com aspas — é JSON, não o valor direto
```

```typescript
const raw = result.stdout.trim();       // '"Portal de Vendas"'
const parsed = JSON.parse(raw);         // 'Portal de Vendas'
const value = String(parsed ?? '');     // 'Portal de Vendas'
```

---

## Transportadoras

| Portal | Nome | Código interno |
|---|---|---|
| Auto America | EXPRESSO SAO MIGUEL LTDA | `'000157'` |
| Roberlo | TRANS-FACE TRANSPORTES LTDA | `'000293'` |

---

## Stdin Interativo em Node.js (readline)

Se o agente usa Node.js com `readline` para interação com o usuário, **não crie e feche um
`readline.Interface` por pergunta**. Com stdin pipeado (não-TTY):

1. O readline consome todo o stdin imediatamente ao ser criado.
2. Quando o pipe fecha (EOF), o readline se auto-fecha.
3. Chamadas subsequentes a `rl.question()` lançam `ERR_USE_AFTER_CLOSE`.

**Solução:** Criar uma única interface, ouvir `'line'` para bufferizar linhas, e servir do buffer:

```typescript
class ConsolePrompter {
  private readonly lineBuffer: string[] = [];
  private readonly pending: Array<(line: string) => void> = [];
  private eof = false;
  private readonly rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  constructor() {
    this.rl.on('line', (line) => {
      const resolve = this.pending.shift();
      if (resolve) resolve(line.trimEnd());
      else this.lineBuffer.push(line.trimEnd());
    });
    this.rl.on('close', () => {
      this.eof = true;
      while (this.pending.length > 0) this.pending.shift()!('');
    });
  }

  private readLine(): Promise<string> {
    if (this.lineBuffer.length > 0) return Promise.resolve(this.lineBuffer.shift()!);
    if (this.eof) return Promise.resolve('');
    return new Promise(resolve => this.pending.push(resolve));
  }

  async ask(question: string): Promise<string> {
    process.stdout.write(`${question} `);
    return this.readLine();
  }
}
```

---

## Resumo das Armadilhas

| Armadilha | Sintoma | Solução |
|---|---|---|
| `.trigger('change')` em campo com `onchange` nativo | Handler não dispara, campo não é preenchido | Usar `dispatchEvent(new Event('change', {bubbles:true}))` |
| `gatProduto()` via `dispatchEvent` com sessão expirada | Toda a página é substituída pela tela de login | Chamar `U_GATPROD.APW` diretamente com `async:false` |
| Navegar direto para `u_AddOrc.apw` sem PR | Erro 500 ou redirecionamento para login | Navegar via clique no link do menu |
| `readline.createInterface` + `rl.close()` por pergunta | `ERR_USE_AFTER_CLOSE` com stdin pipeado | Usar uma única interface + buffer de linhas |
| `TOTAL_ORC` permanece em `0` | `gatProduto()` não foi chamado para o produto | Garantir preenchimento de `CK_XPRCIMP{NN}` via `gatProduto()` ou direto |
| `CK_QTDVEN{NN}` ignorado no Roberlo | Campo está `disabled` | Remover atributo `disabled` antes de preencher |
| `iCK_XDESC03{NN}` não aceita valor | Campo desabilitado via propriedade JS | `el.removeAttribute('disabled'); el.disabled = false` |
| Produto não encontrado no Roberlo | Tabela errada selecionada | Iterar por todas as tabelas em `searchProducts`, manter cache |
