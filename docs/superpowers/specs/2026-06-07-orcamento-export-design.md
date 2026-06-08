# Design — Export do orçamento pós-save

**Projeto:** `do-yourself/agent-orcamento/`
**Branch:** `feat/agent-orcamento`
**Data:** 2026-06-07

## Objetivo

Após salvar um orçamento (`driver.save()`) e ser redirecionado para a listagem
de orçamentos, gerar e **baixar o PDF do orçamento recém-criado** para o disco
local em `public/orcamentos/<provider>/<cliente>.pdf`.

O export é **sempre obrigatório** — não há flag para desativá-lo.

## Investigação ao vivo (agent-browser)

Mapeamento confirmado nos dois portais (ambos Protheus/`.apw`, listagem
`U_orcamento.apw`). O mecanismo é **idêntico**:

| | AutoAmerica | Roberlo |
|---|---|---|
| Listagem | `U_orcamento.apw` | `U_orcamento.apw` |
| Ação export | `PrtOrc(rec)` (ícone `fa-print`, "Imprimir Orçamento") | igual |
| Geração | POST `U_MailOrc.apw?PR=<token>&opc=print` body `opc=print&doc=<rec>` | igual |
| Resposta | nome do arquivo (começa com `orcamento`) | igual |
| PDF | servido em `/anexos/orcamentos/<arquivo>` | igual |
| `rec` | id interno da linha (≠ número exibido), lido do `onclick` | igual |
| Ordenação | número desc → **linha 0 = mais recente** | igual |
| Escopo | listagem escopada ao representante logado | igual |

Comportamento de `PrtOrc(rec)` (idêntico nos dois):
1. `jQuery.ajax` POST para `U_MailOrc.apw?PR=<token>&opc=print` com
   `opc=print&doc=<rec>`.
2. Resposta = nome do arquivo gerado (string iniciando com `orcamento`).
3. `window.open('/anexos/orcamentos/' + arquivo, '_blank')`.

Diferença relevante de colunas: o AutoAmerica tem uma coluna "Bloqueio" a mais
que o Roberlo, então o índice da coluna "Nome" difere entre os portais. Por isso
a coluna do nome do cliente é localizada **pelo texto do cabeçalho "Nome"**, não
por índice fixo.

> Nota ambiente: o Chrome headless bloqueia o IP HTTP do Roberlo
> (`ERR_BLOCKED_BY_CLIENT`). O mapeamento do Roberlo foi feito em modo **headed**
> com liberação manual do aviso de segurança.

## Arquitetura

Abordagem escolhida: **método no driver + writer de arquivo injetado no
orchestrator** (Opção A). Drivers permanecem "só browser"; o IO de arquivo fica
isolado e testável. Lógica de portal compartilhada em um helper único (sem
duplicação entre os dois drivers).

### Fluxo

```
runOrcamento
  └─ ... addLine / discounts / setParcelas
  └─ driver.save()                      // salva e redireciona para U_orcamento.apw
  └─ driver.exportQuote()               // PrtOrc + download dos bytes (base64)
  └─ exportWriter({ platform, clientName, pdfBase64 })   // grava no disco
  └─ return { total, parcelas, exportPath }
```

### Componentes

#### 1. Helper compartilhado — `src/platforms/driver-helpers.ts`

```ts
export interface ExportedQuote {
  pdfBase64: string;
  orcamentoNumber: string;
  clientName: string;
}

/**
 * Exporta o orçamento da primeira linha da listagem (U_orcamento.apw).
 * Recebe o evalRaw do driver (sessão autenticada já posicionada na listagem).
 */
export async function exportLastQuote(
  evalRaw: (js: string) => Promise<string>,
): Promise<ExportedQuote>;
```

Passos executados via `evalRaw` (estilo síncrono `async:false`, como em
`addLine`):

1. Ler a **primeira linha** da tabela (`table tbody tr`):
   - `rec` a partir de `onclick="PrtOrc(<rec>)"` (ou href `opc=edit&rec=<rec>`).
   - `orcamentoNumber` da coluna "Orçamento".
   - `clientName` da coluna cujo **cabeçalho** é "Nome" (índice descoberto
     dinamicamente pelo header — robusto à coluna "Bloqueio" extra do AA).
2. Replicar `PrtOrc`: POST `U_MailOrc.apw?PR=<pr>&opc=print` com
   `opc=print&doc=<rec>` (`async:false`) → capturar o nome do arquivo.
   `pr` lido de `new URLSearchParams(location.search).get('PR')` (mesmo padrão
   usado pelos drivers).
3. Baixar os bytes de `/anexos/orcamentos/<arquivo>` na própria página e
   retornar em **base64** (XHR síncrono com `overrideMimeType` +
   `charset=x-user-defined` para ler binário; conversão para base64 in-page).

Erros (sem linha na listagem, resposta vazia, arquivo não inicia com
`orcamento`, falha no download) → o helper lança `Error` com mensagem
descritiva.

#### 2. Interface `IPortalDriver` — `src/platforms/types.ts`

Novo método (obrigatório nos dois drivers):

```ts
exportQuote(): Promise<DriverResult<ExportedQuote>>;
```

`AutoAmericaDriver.exportQuote()` e `RoberloDriver.exportQuote()` delegam ao
helper `exportLastQuote(this.evalRaw)` e embrulham o resultado em `DriverResult`.

#### 3. Writer de arquivo — `src/io/export-writer.ts` (novo)

```ts
export interface ExportWriterInput {
  platform: Platform;      // 'autoamerica' | 'roberlo'
  clientName: string;      // nome vindo do portal (coluna "Nome")
  pdfBase64: string;
}
export type ExportWriter = (input: ExportWriterInput) => Promise<string>; // path escrito

export function makeExportWriter(baseDir?: string): ExportWriter;
```

- `baseDir` default `./public/orcamentos`, configurável via env
  `ORCAMENTO_EXPORT_DIR`.
- Caminho final: `<baseDir>/<platform>/<clientName-sanitizado>.pdf`.
- Sanitização do nome: remove/troca `/ \ : * ? " < > |` e espaços nas pontas;
  colapsa espaços internos. (Nome do cliente, não do termo do JSON.)
- `mkdir -p` da pasta do provider + grava o buffer decodificado de base64.
- Retorna o caminho absoluto/relativo escrito.

#### 4. Orchestrator — `src/orcamento/orchestrator.ts`

- `RunOrcamentoInput` ganha `exportWriter: ExportWriter` (dependência injetada,
  igual a `prompter`/`repo`).
- `RunOrcamentoResult` ganha `exportPath: string`.
- Após `driver.save()`:

```ts
const exp = await driver.exportQuote();
if (exp.status !== 'success' || !exp.data) {
  throw new Error(
    `Falha no export obrigatório do orçamento (salvo, número pode estar na listagem): ${exp.summary}`,
  );
}
const exportPath = await exportWriter({
  platform: platform.id,
  clientName: exp.data.clientName,
  pdfBase64: exp.data.pdfBase64,
});
return { total, parcelas: plan.label, exportPath };
```

Como o export é obrigatório, a falha é **erro explícito** (não warning). O
orçamento já está salvo; a mensagem orienta a reexportar.

#### 5. CLI — `src/cli/index.ts`

Instancia `makeExportWriter()` e injeta em `runOrcamento(...)`. Ao final, imprime
o `exportPath` no resumo do run.

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| Listagem sem linhas após save | `exportLastQuote` lança → orchestrator lança erro obrigatório |
| `U_MailOrc.apw` retorna vazio / não-`orcamento` | helper lança erro |
| Download do PDF falha | helper lança erro |
| Escrita em disco falha | `exportWriter` propaga o erro de IO |

Em todos os casos o orçamento **já está salvo**; o erro só sinaliza que o PDF
não foi gerado/baixado, permitindo reexport manual.

## Premissa — identificação do orçamento recém-criado

A primeira linha da listagem (ordem decrescente por número, escopo do
representante logado) é o orçamento recém-criado, pois apenas a sessão do agente
cria orçamentos naquele momento. Suficiente para o uso atual. Endurecimento
futuro possível: capturar o número no momento do save e casar a linha
exatamente.

## Testes (TDD)

- `src/io/export-writer.test.ts`
  - sanitização de nomes com caracteres inválidos;
  - montagem do path `<base>/<platform>/<cliente>.pdf`;
  - `mkdir -p` + escrita do buffer (base64 → bytes corretos);
  - respeito ao env `ORCAMENTO_EXPORT_DIR`.
- `src/platforms/driver.test.ts` (ou específicos por driver)
  - `exportQuote` com runner stubado retornando rec + filename + base64;
  - asserts das chamadas `eval` (PrtOrc/U_MailOrc, leitura da linha, download);
  - parsing correto de `{ pdfBase64, orcamentoNumber, clientName }`.
- `src/orcamento/orchestrator.test.ts`
  - `exportQuote` + `exportWriter` chamados após `save`, na ordem correta;
  - `exportPath` presente no resultado;
  - erro obrigatório quando `exportQuote` retorna status ≠ success.

## Fora de escopo (YAGNI)

- Flag de CLI para desativar export (export é sempre obrigatório).
- Envio por e-mail (`abreEmail`) — ação distinta, não solicitada.
- Reexport em lote / reprocessamento de orçamentos antigos.
