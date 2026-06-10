import type { ProductOption, ExportedQuote } from './types.js';

/** "R$ 2.500,00" -> 2500. Strips currency symbol, dots (thousands), converts comma to dot. */
export function parseBRL(text: string): number {
  const cleaned = text
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  if (Number.isNaN(n)) throw new Error(`Valor monetário inválido: "${text}"`);
  return n;
}

/** Splits "CODE - NAME" dropdown labels into { code, name }. */
export function parseDropdownOptions(labels: string[]): ProductOption[] {
  return labels.map((raw) => {
    const idx = raw.indexOf(' - ');
    if (idx === -1) return { code: '', name: raw.trim() };
    return { code: raw.slice(0, idx).trim(), name: raw.slice(idx + 3).trim() };
  });
}

/**
 * JS executado na página (listagem U_orcamento.apw) para exportar o orçamento
 * da primeira linha. Replica PrtOrc(rec) de forma síncrona e baixa o PDF em base64.
 * Retorna SEMPRE JSON.stringify(...) — { rec, orcamentoNumber, clientName, filename, pdfBase64 } ou { error }.
 */
const EXPORT_JS = `(function () {
  try {
    var rows = document.querySelectorAll('table tbody tr');
    if (!rows.length) return JSON.stringify({ error: 'listagem vazia' });
    var tr = rows[0];
    var printA = Array.from(tr.querySelectorAll('a')).find(function (a) {
      return (a.getAttribute('onclick') || '').indexOf('PrtOrc') >= 0;
    });
    var recMatch = printA ? (printA.getAttribute('onclick') || '').match(/PrtOrc\\((\\d+)\\)/) : null;
    var rec = recMatch ? recMatch[1] : '';
    if (!rec) {
      var allOnclicks = Array.from(tr.querySelectorAll('a')).map(function (a) { return a.getAttribute('onclick') || ''; }).filter(Boolean);
      var url = location.href.slice(-120);
      var trHtml = tr.innerHTML.slice(0, 600);
      return JSON.stringify({ error: 'rec nao encontrado na primeira linha', debug: { url: url, onclicks: allOnclicks, trHtml: trHtml } });
    }

    var headers = Array.from(document.querySelectorAll('table thead th')).map(function (th) {
      return th.textContent.replace(/\s/g, ' ').trim().toLowerCase();
    });
    var orcIdx = headers.findIndex(function (h) { return h.indexOf('or') === 0 && h.indexOf('amento') >= 0; });
    var nomeIdx = headers.findIndex(function (h) { return h === 'nome'; });
    var tds = tr.querySelectorAll('td');
    var orcamentoNumber = orcIdx >= 0 && tds[orcIdx] ? tds[orcIdx].textContent.trim() : '';
    var clientName = nomeIdx >= 0 && tds[nomeIdx] ? tds[nomeIdx].textContent.trim() : '';

    var pr = new URLSearchParams(location.search).get('PR') || '';
    var url = 'U_MailOrc.apw' + (pr ? '?PR=' + encodeURIComponent(pr) + '&opc=print' : '?opc=print');
    var filename = '';
    // Replicates PrtOrc exactly: opc=print appears in both URL and POST body (portal requirement).
    jQuery.ajax({
      type: 'POST', async: false, cache: false, url: url,
      data: 'opc=print&doc=' + rec,
      success: function (d) { filename = (typeof d === 'string') ? d.trim() : ''; }
    });
    if (filename.indexOf('orcamento') !== 0) {
      return JSON.stringify({ error: 'resposta inesperada de U_MailOrc: ' + String(filename).slice(0, 80) });
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/anexos/orcamentos/' + filename, false);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.send(null);
    if (xhr.status !== 200) return JSON.stringify({ error: 'download falhou (status ' + xhr.status + ')' });
    var bin = xhr.responseText;
    var out = '';
    for (var i = 0; i < bin.length; i++) { out += String.fromCharCode(bin.charCodeAt(i) & 0xff); }
    var pdfBase64 = btoa(out);

    return JSON.stringify({ rec: rec, orcamentoNumber: orcamentoNumber, clientName: clientName, filename: filename, pdfBase64: pdfBase64 });
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;

interface ExportPayload {
  rec?: string;
  orcamentoNumber?: string;
  clientName?: string;
  filename?: string;
  pdfBase64?: string;
  error?: string;
}

/**
 * Exporta o orçamento da primeira linha da listagem.
 * `evalRaw` é o método do driver que roda JS na página (sessão autenticada,
 * já posicionada em U_orcamento.apw após o save).
 */
export async function exportLastQuote(
  evalRaw: (js: string) => Promise<string>,
): Promise<ExportedQuote> {
  const payload = JSON.parse(await evalRaw(EXPORT_JS)) as ExportPayload;
  if (payload.error) throw new Error(`Falha no export: ${payload.error}`);
  if (!payload.pdfBase64) throw new Error('Falha no export: PDF vazio');
  return {
    pdfBase64: payload.pdfBase64,
    orcamentoNumber: payload.orcamentoNumber ?? '',
    clientName: payload.clientName ?? '',
  };
}
