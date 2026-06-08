import type { IPortalDriver, StartQuoteOpts, DriverResult, ProductOption, ParcelaPlan, ExportedQuote } from './types.js';
import type { AgentBrowserRunner } from './agent-browser-runner.js';
import { parseBRL, exportLastQuote } from './driver-helpers.js';

const LOGIN_URL = 'https://representante.autoamerica.com.br:5100/portal/U_PortalLogin.apw';

// CJ_CONDPAG option values for each plan label
const PARCELAS_CODE: Record<string, string> = {
  '30/60': '031',
  '30/60/90': '032',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export class AutoAmericaDriver implements IPortalDriver {
  private itemCount = 0;

  constructor(
    private readonly runner: AgentBrowserRunner,
    private readonly user: string,
    private readonly pass: string,
  ) {}

  private async evalRaw(js: string): Promise<string> {
    const result = await this.runner(['eval', js]);
    if (result.code !== 0) throw new Error(`eval failed: ${result.stderr.trim()}`);
    // agent-browser eval serialises the return value as JSON (strings get outer quotes).
    // Parse once to recover the actual JS value, then coerce to string.
    const raw = result.stdout.trim();
    if (!raw) return '';
    const parsed: unknown = JSON.parse(raw);
    return parsed == null ? '' : String(parsed);
  }

  private async evalJson<T>(js: string): Promise<T> {
    return JSON.parse(await this.evalRaw(js)) as T;
  }

  private async navigate(url: string): Promise<void> {
    const result = await this.runner(['navigate', url]);
    if (result.code !== 0) throw new Error(`navigate failed: ${result.stderr.trim()}`);
  }

  private async waitLoad(): Promise<void> {
    await this.runner(['wait', '--load', 'networkidle']);
  }

  private async waitFor(conditionJs: string, maxMs = 3000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const ok = await this.evalRaw(`String(!!(${conditionJs}))`);
      if (ok === 'true') return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  async login(): Promise<DriverResult> {
    await this.navigate(LOGIN_URL);
    await this.waitLoad();

    await this.evalRaw(`
      var txts = document.querySelectorAll('input[type="text"],input:not([type])');
      var pwds = document.querySelectorAll('input[type="password"]');
      if (txts[0]) txts[0].value = ${JSON.stringify(this.user)};
      if (pwds[0]) pwds[0].value = ${JSON.stringify(this.pass)};
      var btn = Array.from(document.querySelectorAll('button')).find(b => b.type === 'submit' || b.textContent.trim().length > 0);
      if (btn) btn.click();
      'clicked'
    `);
    await this.waitLoad();

    return { status: 'success', summary: 'Login realizado no Auto America' };
  }

  async startQuote(opts: StartQuoteOpts): Promise<DriverResult> {
    // The orçamento URL carries a session-specific PR token — navigate via menu link,
    // not a hardcoded URL, to avoid 500 errors.
    await this.evalRaw(
      `document.querySelector('a[href*="U_orcamento.apw"]')?.click(); 'ok'`,
    );
    await this.waitLoad();

    // Click "Novo Orçamento"
    await this.evalRaw(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Novo Or'))?.click(); 'ok'`,
    );
    await this.waitLoad();

    // Confirm filial modal (click OK)
    await this.evalRaw(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'OK')?.click(); 'ok'`,
    );
    await this.waitLoad();

    // Find client option value by searching CNPJ/name in pre-loaded options.
    // The portal stores CNPJs as "027980912/0001 - NAME" (9-digit padded root + branch).
    // Normalize: strip non-digits from the option text and match the first 8
    // digits of the search term (the CNPJ company root) anywhere inside it.
    const clientValue = await this.evalRaw(`
      var term = ${JSON.stringify(opts.client)};
      var termRoot = term.replace(/[^0-9]/g, '').substring(0, 8);
      var opt = Array.from(document.getElementById('CJ_CLIENTE').options)
        .find(o => {
          var textDigits = o.text.replace(/[^0-9]/g, '');
          return textDigits.includes(termRoot) || o.text.includes(term);
        });
      opt ? opt.value : ''
    `);

    if (!clientValue) {
      return { status: 'error', summary: `Cliente não encontrado: ${opts.client}`, next_actions: ['Verifique o CNPJ/nome do cliente'] };
    }

    // 1. Select client and trigger SelCliente() which loads price tables via async AJAX.
    await this.evalRaw(`
      jQuery('#CJ_CLIENTE').val(${JSON.stringify(clientValue)});
      SelCliente();
      'done'
    `);

    // Wait for SelCliente() AJAX to populate CJ_TABELA options.
    const tabelasLoaded = await this.waitFor(`document.getElementById('CJ_TABELA')?.options.length > 1`, 10000);
    if (!tabelasLoaded) {
      return { status: 'error', summary: 'Tabelas de preço não carregaram (SelCliente timeout)' };
    }

    // 2. Set price table and call selProd() which loads products via synchronous AJAX.
    // opts.tabelaPrecos may be "099 - DESCRIÇÃO"; match by option value OR text.
    const tabelaSearch = JSON.stringify(opts.tabelaPrecos ?? '099');
    await this.evalRaw(`
      var tSearch = ${tabelaSearch};
      var tOpt = Array.from(document.getElementById('CJ_TABELA').options)
        .find(o => o.value && (o.value === tSearch || o.text === tSearch || o.text.includes(tSearch) || tSearch.startsWith(o.value)));
      jQuery('#CJ_TABELA').val(tOpt ? tOpt.value : tSearch);
      selProd();
      'done'
    `);

    // Wait for products to be populated (selProd uses async:false, but we verify anyway).
    const produtosLoaded = await this.waitFor(`document.getElementById('CK_PRODUTO01')?.options.length > 1`, 10000);
    if (!produtosLoaded) {
      return { status: 'error', summary: 'Produtos não carregaram (selProd timeout)' };
    }

    // 3. Set remaining header fields.
    await this.evalRaw(`
      jQuery('#CJ_XTPORC').val('3').trigger('change');
      jQuery('#CJ_TPFRETE').val('C').trigger('change');
      jQuery('#CJ_XTRANSP').val('000157').trigger('change');
      'done'
    `);

    this.itemCount = 0;
    return { status: 'success', summary: `Orçamento iniciado para ${opts.client}` };
  }

  async readUnitsPerBox(productCode: string): Promise<number | undefined> {
    // Safe to mutate CK_PRODUTO01 here: readUnitsPerBox is always called during
    // resolveLine (before any addLine), and addLine for item 01 always re-sets
    // CK_PRODUTO01 before its own U_GATPROD.APW call.
    // U_GATPROD.APW requires the product to be selected in a form row to return
    // quantidadeembalagem — mirroring what addLine does before its own AJAX call.
    const raw = await this.evalRaw(`
      (function() {
        var pr = new URLSearchParams(location.search).get('PR') || '';
        var result = '';
        jQuery('#CK_PRODUTO01').val(${JSON.stringify(productCode)});
        jQuery.ajax({
          type: 'POST',
          url: 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : ''),
          data: {
            produto:    ${JSON.stringify(productCode)},
            tabela:     jQuery('#CJ_TABELA').val() || '',
            cliente:    jQuery('#CJ_CLIENTE').val() || '',
            descvista:  0,
            descretir:  0,
            descredesp: 0,
            valfrete:   0
          },
          async: false,
          success: function(data) {
            if (!data || data.toUpperCase().indexOf('<META HTTP-EQUIV') >= 0) return;
            try {
              var oRet = JSON.parse(data);
              if (oRet.erro) { result = '__ERROR__'; return; }
              result = String(oRet.quantidadeembalagem ?? '');
            } catch(e) {}
          },
          error: function() {
            result = '__ERROR__';
          }
        });
        return result;
      })()
    `);
    if (raw === '__ERROR__') return undefined;
    const n = parseInt(raw, 10);
    return n > 0 ? n : undefined;
  }

  async searchProducts(terms: string): Promise<DriverResult<ProductOption[]>> {
    // Products are pre-loaded (280 options) in CK_PRODUTO01 — filter client-side
    const data = await this.evalJson<ProductOption[]>(`
      JSON.stringify(
        Array.from(document.getElementById('CK_PRODUTO01').options)
          .filter(o => o.value && o.text.toLowerCase().includes(${JSON.stringify(terms.toLowerCase())}))
          .slice(0, 20)
          .map(o => ({code: o.value, name: o.text}))
      )
    `);

    if (data.length === 0) {
      return { status: 'warning', summary: `Nenhum produto encontrado para: "${terms}"`, data: [] };
    }
    return { status: 'success', summary: `${data.length} produto(s) encontrado(s)`, data };
  }

  async addLine(productCode: string, units: number): Promise<DriverResult> {
    this.itemCount += 1;
    const n = pad(this.itemCount);

    if (this.itemCount > 1) {
      await this.evalRaw(`document.getElementById('btAddItm').click(); 'clicked'`);
      const appeared = await this.waitFor(`document.getElementById('CK_PRODUTO${n}')`);
      if (!appeared) {
        this.itemCount -= 1;
        return { status: 'error', summary: `Linha ${n} não apareceu após clicar em Novo Item` };
      }
    }

    // Set product (options pre-loaded, set by value directly)
    await this.evalRaw(
      `jQuery('#CK_PRODUTO${n}').val(${JSON.stringify(productCode)}).trigger('change'); 'done'`,
    );

    // Populate price field by calling U_GATPROD.APW directly (async:false).
    // jQuery .trigger('change') does NOT fire native onchange attributes, so
    // gatProduto() is never called automatically — we replicate its AJAX call here.
    const priceResult = await this.evalRaw(`
      (function() {
        var pr = new URLSearchParams(location.search).get('PR') || '';
        var result = '';
        jQuery.ajax({
          type: 'POST',
          url: 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : ''),
          data: {
            produto:    ${JSON.stringify(productCode)},
            tabela:     jQuery('#CJ_TABELA').val() || '',
            cliente:    jQuery('#CJ_CLIENTE').val() || '',
            descvista:  0,
            descretir:  0,
            descredesp: 0,
            valfrete:   0
          },
          async: false,
          success: function(data) {
            if (!data || data.toUpperCase().indexOf('<META HTTP-EQUIV') >= 0) return;
            try {
              var oRet = JSON.parse(data);
              if (oRet.erro) { result = '__ERROR__'; return; }
              var priceEl = document.getElementById('CK_XPRCIMP${n}');
              if (priceEl) priceEl.value = oRet.preco || '';
              var qtdEl = document.getElementById('QTD_EMB${n}');
              if (qtdEl) qtdEl.value = oRet.quantidadeembalagem != null ? String(oRet.quantidadeembalagem) : '';
              result = oRet.preco || '';
            } catch(e) {}
          },
          error: function() {
            result = '__ERROR__';
          }
        });
        return result;
      })()`);

    if (priceResult === '__ERROR__') {
      this.itemCount -= 1;
      return { status: 'error', summary: `Falha ao buscar preço do produto ${productCode} (U_GATPROD.APW)` };
    }

    // Set quantity and trigger price recalculation
    await this.evalRaw(`
      var q = document.getElementById('CK_QTDVEN${n}');
      q.value = ${JSON.stringify(String(units))};
      q.dispatchEvent(new Event('change', {bubbles:true}));
      VldValor('${n}');
      'done'
    `);

    return { status: 'success', summary: `Item ${n}: produto ${productCode} × ${units} un` };
  }

  async updateLine(productCode: string, units: number): Promise<DriverResult> {
    const result = await this.evalRaw(`
      var n = null;
      for (var i = 1; i <= ${this.itemCount}; i++) {
        var nn = String(i).padStart(2,'0');
        if (document.getElementById('CK_PRODUTO'+nn)?.value === ${JSON.stringify(productCode)}) { n = nn; break; }
      }
      if (!n) 'not_found';
      else {
        var q = document.getElementById('CK_QTDVEN'+n);
        q.value = ${JSON.stringify(String(units))};
        q.dispatchEvent(new Event('change', {bubbles:true}));
        VldValor(n);
        'done'
      }
    `);
    if (result === 'not_found') {
      return { status: 'error', summary: `Produto ${productCode} não encontrado nas linhas` };
    }
    return { status: 'success', summary: `Produto ${productCode} atualizado para ${units} un` };
  }

  async readLinePrice(productCode: string): Promise<DriverResult<{ unit: number; total: number }>> {
    const raw = await this.evalRaw(`
      var n = null;
      for (var i = 1; i <= ${this.itemCount}; i++) {
        var nn = String(i).padStart(2,'0');
        if (document.getElementById('CK_PRODUTO'+nn)?.value === ${JSON.stringify(productCode)}) { n = nn; break; }
      }
      n
        ? JSON.stringify({unit: document.getElementById('CK_XPRCIMP'+n)?.value||'0', total: document.getElementById('CK_VALOR'+n)?.value||'0'})
        : 'null'
    `);

    if (raw === 'null') {
      return { status: 'error', summary: `Produto ${productCode} não encontrado nas linhas` };
    }

    const { unit, total } = JSON.parse(raw) as { unit: string; total: string };
    return {
      status: 'success',
      summary: `Preços lidos: unit=${unit} total=${total}`,
      data: { unit: parseBRL(unit), total: parseBRL(total) },
    };
  }

  async applyDiscount(productCode: string, pct: number): Promise<DriverResult> {
    const result = await this.evalRaw(`
      var n = null;
      for (var i = 1; i <= ${this.itemCount}; i++) {
        var nn = String(i).padStart(2,'0');
        if (document.getElementById('CK_PRODUTO'+nn)?.value === ${JSON.stringify(productCode)}) { n = nn; break; }
      }
      if (!n) 'not_found';
      else {
        var d = document.getElementById('CK_DESCONT'+n);
        d.removeAttribute('disabled');
        d.value = ${JSON.stringify(pct.toFixed(2).replace('.', ','))};
        VldValor(n);
        'ok'
      }
    `);

    if (result === 'not_found') {
      return { status: 'error', summary: `Produto ${productCode} não encontrado para aplicar desconto` };
    }
    return { status: 'success', summary: `Desconto ${pct}% aplicado em ${productCode}` };
  }

  async readOrderTotal(): Promise<DriverResult<number>> {
    const raw = await this.evalRaw(`document.getElementById('TOTAL_ORC')?.value || '0'`);
    return { status: 'success', summary: `Total do pedido: ${raw}`, data: parseBRL(raw) };
  }

  async setParcelas(plan: ParcelaPlan): Promise<DriverResult> {
    const code = PARCELAS_CODE[plan.label];
    if (!code) {
      return {
        status: 'error',
        summary: `Condição de pagamento não mapeada: "${plan.label}"`,
        next_actions: ['Valores suportados: 30/60, 30/60/90'],
      };
    }
    await this.evalRaw(`jQuery('#CJ_CONDPAG').val(${JSON.stringify(code)}).trigger('change'); 'done'`);
    return { status: 'success', summary: `Parcelas definidas: ${plan.label} (código ${code})` };
  }

  async save(): Promise<DriverResult> {
    await this.evalRaw(`document.getElementById('btSalvar').click(); 'clicked'`);
    await this.waitLoad();
    // After save the portal redirects to U_orcamento.apw (listing).
    // Wait for at least one table row so exportQuote() doesn't run on a half-loaded page.
    await this.waitFor(`document.querySelector('table tbody tr')`, 10000);
    return { status: 'success', summary: 'Orçamento salvo com sucesso' };
  }

  async exportQuote(): Promise<DriverResult<ExportedQuote>> {
    try {
      const data = await exportLastQuote((js) => this.evalRaw(js));
      return {
        status: 'success',
        summary: `Orçamento ${data.orcamentoNumber} exportado (${data.clientName})`,
        data,
      };
    } catch (e) {
      return { status: 'error', summary: `Falha ao exportar orçamento: ${(e as Error).message}` };
    }
  }
}
