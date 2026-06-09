import type {
  IPortalDriver,
  StartQuoteOpts,
  DriverResult,
  ProductOption,
  ParcelaPlan,
  ExportedQuote,
  ClientOption,
  PriceTableOption,
} from './types.js';
import type { AgentBrowserRunner } from './agent-browser-runner.js';
import { parseBRL, exportLastQuote } from './driver-helpers.js';

const LOGIN_URL = 'http://52.67.57.130/portal/U_PortalLogin.apw';

// CJ_CONDPAG option values
const PARCELAS_CODE: Record<string, string> = {
  '30/60/90': '032',
  '30/60': '031',
};

// TRANS-FACE TRANSPORTES LTDA - 61683652000243
const TRANSPORTADORA_CODE = '000293';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Result from reading the detalhe modal — which desconto to apply and its value. */
export interface MaxDiscountResult {
  pct: number;
  /** Which Desconto field to fill in the apply modal: 2, 3, or 0 (none). */
  whichDesc: 0 | 2 | 3;
}

export class RoberloDriver implements IPortalDriver {
  private itemCount = 0;
  private startOpts?: StartQuoteOpts;
  /** Maps productCode → tabela code (discovered during searchProducts or addLine). */
  private readonly productTabela = new Map<string, string>();
  /** Stores whichDesc per product for use in applyDiscount after readMaxDiscount. */
  private readonly pendingDiscount = new Map<string, MaxDiscountResult>();

  constructor(
    private readonly runner: AgentBrowserRunner,
    private readonly user: string,
    private readonly pass: string,
  ) {}

  private async evalRaw(js: string): Promise<string> {
    const result = await this.runner(['eval', js]);
    if (result.code !== 0)
      throw new Error(`eval failed: ${result.stderr.trim()}`);
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
    if (result.code !== 0)
      throw new Error(`navigate failed: ${result.stderr.trim()}`);
  }

  private async waitLoad(): Promise<void> {
    await this.runner(['wait', '--load', 'networkidle']);
  }

  private async waitFor(conditionJs: string, maxMs = 3000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const ok = await this.evalRaw(`String(!!(${conditionJs}))`);
      if (ok === 'true') return true;
      await new Promise((r) => setTimeout(r, 200));
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
      var btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Acessar') || document.querySelector('button');
      if (btn) btn.click();
      'clicked'
    `);
    await this.waitLoad();

    return { status: 'success', summary: 'Login realizado no Roberlo' };
  }

  async searchClients(terms: string): Promise<DriverResult<ClientOption[]>> {
    const data = await this.evalJson<ClientOption[]>(`
      JSON.stringify(
        (function() {
          var words = ${JSON.stringify(terms.toLowerCase())}.split(/\\s+/).filter(Boolean);
          return Array.from(document.getElementById('CJ_CLIENTE').options)
            .filter(function(o) {
              if (!o.value) return false;
              var text = o.text.toLowerCase();
              return words.every(function(w) { return text.includes(w); });
            })
            .map(function(o) { return {code: o.value, name: o.text}; });
        })()
      )
    `);

    if (data.length === 0) {
      return {
        status: 'warning',
        summary: `Nenhum cliente encontrado para: "${terms}"`,
        data: [],
      };
    }
    return {
      status: 'success',
      summary: `${data.length} cliente(s) encontrado(s)`,
      data,
    };
  }

  async selectClient(code: string): Promise<DriverResult> {
    // Before running any jQuery based command, ensure jQuery is loaded.
    // Protheus/APW can be slow to inject scripts into the DOM.
    await this.waitFor(`typeof jQuery !== 'undefined'`, 10000);

    await this.evalRaw(`
      (function() {
        var el = jQuery('#CJ_CLIENTE');
        el.val(${JSON.stringify(code)}).trigger('change');
        el.focus().blur();
      })();
      'done'
    `);

    // Wait for the dynamic loading modal (blockUI/modal) to disappear
    await this.waitFor(
      `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
      15000,
    );

    return { status: 'success', summary: `Cliente ${code} selecionado` };
  }

  async listPriceTables(): Promise<DriverResult<PriceTableOption[]>> {
    const data = await this.evalJson<PriceTableOption[]>(`
      JSON.stringify(
        Array.from(document.getElementById('CK_XTABELA01').options)
          .filter(o => o.value)
          .map(o => ({code: o.value, name: o.text}))
      )
    `);

    return {
      status: 'success',
      summary: `${data.length} tabela(s) de preço encontrada(s)`,
      data,
    };
  }

  async selectPriceTable(code: string): Promise<DriverResult> {
    await this.evalRaw(`
      (function() {
        var el = jQuery('#CK_XTABELA01');
        el.val(${JSON.stringify(code)}).trigger('change');
        el.focus().blur();
      })();
      'done'
    `);

    // Wait for the dynamic loading modal (blockUI/modal) to disappear
    await this.waitFor(
      `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
      15000,
    );

    const produtosLoaded = await this.waitFor(
      `document.getElementById('CK_PRODUTO01')?.options.length > 1`,
      10000,
    );
    if (!produtosLoaded) {
      return {
        status: 'error',
        summary: 'Produtos não carregaram (table selection timeout)',
      };
    }

    if (this.startOpts) {
      const { frete, transportadora } = this.startOpts;
      const freteCode = frete === 'FOB' ? 'F' : 'C';

      // Sequence field updates to avoid concurrent AJAX/UI reset conflicts
      const headerFields = [
        { id: '#CJ_TPFRETE', value: freteCode },
        { id: '#CJ_XTRANSP', value: transportadora || '000293' },
        { id: '#CJ_XTPORC', value: '2' }, // Previsto
      ];

      for (const field of headerFields) {
        // Wait for UI to be clear before setting
        await this.waitFor(
          `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
          5000,
        );

        await this.evalRaw(`
          (function() {
            var el = jQuery(${JSON.stringify(field.id)});
            if (el.length) {
              el.val(${JSON.stringify(field.value)}).trigger('change');
              el.focus().blur();
            }
          })();
          'done'
        `);
        // Brief pause for any triggers to start
        await new Promise((r) => setTimeout(r, 200));
      }

      // Final blur to clear focus trapping
      await this.evalRaw(
        `if (document.activeElement) document.activeElement.blur(); 'done'`,
      );

      await this.waitFor(
        `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
        10000,
      );
    }

    return {
      status: 'success',
      summary: `Tabela de preço ${code} selecionada`,
    };
  }

  async startQuote(opts: StartQuoteOpts): Promise<DriverResult> {
    this.startOpts = opts;
    // Navigate via JS click to preserve session (direct URL navigation loses session token)
    await this.evalRaw(
      `Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Orçamento de Venda'))?.click(); 'ok'`,
    );
    await this.waitLoad();

    // Click "Novo Orçamento"
    await this.evalRaw(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Novo Orç'))?.click(); 'ok'`,
    );
    await this.waitLoad();

    this.itemCount = 0;
    this.productTabela.clear();
    this.pendingDiscount.clear();
    return {
      status: 'success',
      summary: 'Orçamento preparado (aguardando seleção de cliente)',
    };
  }

  /** Selects the first non-empty tabela for the given item, loads product options. */
  private async selectFirstTabela(n: string): Promise<string> {
    const tabelaCode = await this.evalRaw(`
      var opt = Array.from(document.getElementById('CK_XTABELA${n}').options)
        .find(o => o.value);
      opt ? opt.value : ''
    `);
    if (tabelaCode) {
      await this.evalRaw(
        `jQuery('#CK_XTABELA${n}').val(${JSON.stringify(tabelaCode)}).trigger('change'); 'done'`,
      );
      await this.waitFor(
        `document.getElementById('CK_PRODUTO${n}')?.options.length > 1`,
        5000,
      );
    }
    return tabelaCode;
  }

  /** Finds which tabela contains the given product code for item NN. */
  private async findTabela(n: string, productCode: string): Promise<string> {
    const tabelaOptions = await this.evalJson<Array<{ value: string }>>(`
      JSON.stringify(Array.from(document.getElementById('CK_XTABELA${n}').options)
        .filter(o => o.value)
        .map(o => ({value: o.value})))
    `);

    for (const { value: tabelaCode } of tabelaOptions) {
      await this.evalRaw(
        `jQuery('#CK_XTABELA${n}').val(${JSON.stringify(tabelaCode)}).trigger('change'); 'done'`,
      );
      await this.waitFor(
        `document.getElementById('CK_PRODUTO${n}')?.options.length > 1`,
        5000,
      );
      const found = await this.evalRaw(
        `!!Array.from(document.getElementById('CK_PRODUTO${n}').options).find(o => o.value === ${JSON.stringify(productCode)})`,
      );
      if (found === 'true') return tabelaCode;
    }
    return '';
  }

  async readUnitsPerBox(productCode: string): Promise<number | undefined> {
    const slot = '01';
    // Safe to mutate CK_XTABELA01 here: readUnitsPerBox is always called during
    // resolveLine (before any addLine), and addLine always re-sets CK_XTABELA{n}
    // to the correct tabela for its product before the AJAX price call.

    // Roberlo requires a tabela to be active so U_GATPROD.APW returns the right product.
    // searchProducts() already populates productTabela for every found product,
    // so by the time readUnitsPerBox is called the tabela code should be cached.
    const tabelaCode = this.productTabela.get(productCode) ?? '';
    if (tabelaCode) {
      await this.evalRaw(
        `jQuery('#CK_XTABELA${slot}').val(${JSON.stringify(tabelaCode)}).trigger('change'); 'done'`,
      );
      await this.waitFor(
        `document.getElementById('CK_PRODUTO${slot}')?.options.length > 1`,
        5000,
      );
    } else {
      const current = await this.evalRaw(
        `document.getElementById('CK_XTABELA${slot}')?.value || ''`,
      );
      if (!current) await this.selectFirstTabela(slot);
    }

    // Call U_GATPROD.APW directly with async:false — same endpoint the portal uses
    // internally in gatProduto(), but without depending on DOM event handlers or polling.
    const raw = await this.evalRaw(`
      (function() {
        var pr = new URLSearchParams(location.search).get('PR') || '';
        var result = '';
        var csrf = jQuery('input[name="CSRFToken"]').val() || '';
        jQuery.ajax({
          type: 'POST',
          url: 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : ''),
          data: {
            CSRFToken:  csrf,
            produto:    ${JSON.stringify(productCode)},
            tabela:     jQuery('#CK_XTABELA${slot}').val() || '',
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
    const units = parseInt(raw, 10);
    return units > 0 ? units : undefined;
  }

  async searchProducts(terms: string): Promise<DriverResult<ProductOption[]>> {
    // Ensure item 01 has a tabela selected so products are loaded
    const n = '01';
    const currentTabela = await this.evalRaw(
      `document.getElementById('CK_XTABELA${n}')?.value || ''`,
    );
    if (!currentTabela) {
      await this.selectFirstTabela(n);
    }

    // Search across all tabela options to gather all matching products
    const tabelaOptions = await this.evalJson<Array<{ value: string }>>(`
      JSON.stringify(Array.from(document.getElementById('CK_XTABELA${n}').options)
        .filter(o => o.value).map(o => ({value: o.value})))
    `);

    const allResults = new Map<string, ProductOption>();
    const lowerTerms = terms.toLowerCase();

    for (const { value: tabelaCode } of tabelaOptions) {
      await this.evalRaw(
        `jQuery('#CK_XTABELA${n}').val(${JSON.stringify(tabelaCode)}).trigger('change'); 'done'`,
      );
      await this.waitFor(
        `document.getElementById('CK_PRODUTO${n}')?.options.length > 1`,
        5000,
      );

      const opts = await this.evalJson<ProductOption[]>(`
        JSON.stringify(
          Array.from(document.getElementById('CK_PRODUTO${n}').options)
            .filter(o => o.value && o.text.toLowerCase().includes(${JSON.stringify(lowerTerms)}))
            .slice(0, 20)
            .map(o => ({code: o.value, name: o.text}))
        )
      `);

      for (const opt of opts) {
        if (!allResults.has(opt.code)) {
          allResults.set(opt.code, opt);
          this.productTabela.set(opt.code, tabelaCode);
        }
      }
    }

    const data = Array.from(allResults.values()).slice(0, 20);
    if (data.length === 0) {
      return {
        status: 'warning',
        summary: `Nenhum produto encontrado para: "${terms}"`,
        data: [],
      };
    }
    return {
      status: 'success',
      summary: `${data.length} produto(s) encontrado(s)`,
      data,
    };
  }

  async addLine(productCode: string, units: number): Promise<DriverResult> {
    this.itemCount += 1;
    const n = pad(this.itemCount);

    if (this.itemCount > 1) {
      // Robustly wait for any UI block to clear before clicking "Novo Item"
      await this.waitFor(
        `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
        10000,
      );

      // Clear any previous error notifications or focus that might block the button
      await this.evalRaw(`
        (function() {
          jQuery('.ui-pnotify-closer').click();
          // Bootbox/Modal OK buttons
          var ok = jQuery('.modal-dialog button[data-bb-handler="ok"], .modal-dialog button.btn-primary').filter(':visible');
          if (ok.length) ok.click();
          if (document.activeElement) document.activeElement.blur();
        })();
        'done'
      `);

      // Extra wait if we clicked a modal
      await new Promise((r) => setTimeout(r, 500));

      await this.evalRaw(`
        (function() {
          var btn = document.getElementById('btAddItm');
          if (btn) {
            btn.scrollIntoView();
            btn.click();
          }
        })();
        'clicked'
      `);

      const appeared = await this.waitFor(
        `document.getElementById('CK_XTABELA${n}')`,
        10000,
      );
      if (!appeared) {
        this.itemCount -= 1;
        return {
          status: 'error',
          summary: `Linha ${n} não apareceu após clicar em Novo Item. Verifique se algum aviso bloqueou a tela.`,
        };
      }
    }

    // Select the right tabela for this product
    let tabelaCode = this.productTabela.get(productCode) ?? '';
    if (!tabelaCode) {
      tabelaCode = await this.findTabela(n, productCode);
    } else {
      await this.evalRaw(
        `jQuery('#CK_XTABELA${n}').val(${JSON.stringify(tabelaCode)}).trigger('change'); 'done'`,
      );
      await this.waitFor(
        `document.getElementById('CK_PRODUTO${n}')?.options.length > 1`,
        5000,
      );
    }

    if (!tabelaCode) {
      this.itemCount -= 1;
      return {
        status: 'error',
        summary: `Tabela não encontrada para produto ${productCode}`,
      };
    }

    // Set product
    await this.evalRaw(
      `jQuery('#CK_PRODUTO${n}').val(${JSON.stringify(productCode)}).trigger('change'); 'done'`,
    );

    // Wait for any portal-side background loading ("buscando produto") triggered by product selection
    await this.waitFor(
      `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
      10000,
    );

    // Populate price field by calling U_GATPROD.APW directly (async:false).
    // jQuery .trigger('change') does NOT fire native onchange attributes, so
    // gatProduto() is never called automatically — we replicate its AJAX call here.
    // Roberlo uses per-line tabela (CK_XTABELA${n}), not the global CJ_TABELA.
    const priceResult = await this.evalRaw(`
      (function() {
        // First, check for any blocking modals (like out of stock) and clear them
        var modalOk = jQuery('.modal-dialog button[data-bb-handler="ok"], .modal-dialog button.btn-primary').filter(':visible');
        if (modalOk.length) {
          modalOk.click();
          // Small delay for modal animation
          var start = Date.now(); while(Date.now() - start < 300) {}
        }

        var pr = new URLSearchParams(location.search).get('PR') || '';
        var result = '';
        var csrf = jQuery('input[name="CSRFToken"]').val() || '';
        jQuery.ajax({
          type: 'POST',
          url: 'U_GATPROD.APW' + (pr ? '?PR=' + encodeURIComponent(pr) : ''),
          data: {
            CSRFToken:  csrf,
            produto:    ${JSON.stringify(productCode)},
            tabela:     jQuery('#CK_XTABELA${n}').val() || '',
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
              if (oRet.erro) {
                result = '__ERROR__:' + (oRet.erro || 'Desconhecido');
                return;
              }
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

    if (priceResult.startsWith('__ERROR__')) {
      this.itemCount -= 1;
      return {
        status: 'error',
        summary: `Falha ao buscar preço do produto ${productCode}: ${priceResult.split(':')[1] || 'Erro na requisição U_GATPROD.APW'}`,
      };
    }

    // Set quantity (field is disabled — must enable first)
    // Use robust filling logic: trigger change and focus/blur
    await this.evalRaw(`
      (function() {
        var q = jQuery('#CK_QTDVEN${n}');
        q.removeAttr('disabled');
        q.val(${JSON.stringify(String(units))}).trigger('change');
        q.focus().blur();
        // Roberlo also uses keyup to trigger some local calcs
        q.trigger('keyup');
      })();
      'done'
    `);

    return {
      status: 'success',
      summary: `Item ${n}: produto ${productCode} × ${units} un`,
    };
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
        var q = jQuery('#CK_QTDVEN'+n);
        q.removeAttr('disabled');
        q.val(${JSON.stringify(String(units))}).trigger('change');
        q.focus().blur();
        q.trigger('keyup');
        'done'
      }
    `);
    if (result === 'not_found') {
      return {
        status: 'error',
        summary: `Produto ${productCode} não encontrado nas linhas`,
      };
    }
    return {
      status: 'success',
      summary: `Produto ${productCode} atualizado para ${units} un`,
    };
  }

  async readLinePrice(
    productCode: string,
  ): Promise<DriverResult<{ unit: number; total: number }>> {
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
      return {
        status: 'error',
        summary: `Produto ${productCode} não encontrado nas linhas`,
      };
    }

    const { unit, total } = JSON.parse(raw) as { unit: string; total: string };
    return {
      status: 'success',
      summary: `Preços lidos: unit=${unit} total=${total}`,
      data: { unit: parseBRL(unit), total: parseBRL(total) },
    };
  }

  /**
   * Reads the maximum available discount for a product from the portal's detalhe modal.
   * Roberlo-specific — accessed via duck-typing in the orchestrator.
   * Priority: Desconto 02 → Desconto 03 → 0 (none).
   */
  async readMaxDiscount(productCode: string): Promise<MaxDiscountResult> {
    const n = await this.evalRaw(`
      var n = null;
      for (var i = 1; i <= ${this.itemCount}; i++) {
        var nn = String(i).padStart(2,'0');
        if (document.getElementById('CK_PRODUTO'+nn)?.value === ${JSON.stringify(productCode)}) { n = nn; break; }
      }
      n || ''
    `);

    if (!n) return { pct: 0, whichDesc: 0 };

    // Open detalhe modal
    await this.evalRaw(`detalheOrc('${n}'); 'ok'`);
    await this.waitFor(`document.querySelector('.modal.in')`, 3000);

    const discounts = await this.evalJson<Record<string, string>>(`
      var modal = document.querySelector('.modal.in');
      var result = {};
      if (modal) {
        Array.from(modal.querySelectorAll('label.control-label')).forEach(lbl => {
          var inp = lbl.closest('.col-lg-3')?.querySelector('input');
          if (inp) result[lbl.textContent.trim()] = inp.value;
        });
      }
      JSON.stringify(result)
    `);

    // Close modal
    await this.evalRaw(
      `document.querySelector('.modal.in .bootbox-close-button')?.click(); 'closed'`,
    );
    await this.waitFor(`!document.querySelector('.modal.in')`, 1000);

    const desc2 = parseFloat(discounts['% Desconto 2'] ?? '0');
    const desc3 = parseFloat(discounts['% Desconto 3'] ?? '0');

    let result: MaxDiscountResult;
    if (desc2 > 0) {
      result = { pct: desc2, whichDesc: 2 };
    } else if (desc3 > 0) {
      result = { pct: desc3, whichDesc: 3 };
    } else {
      result = { pct: 0, whichDesc: 0 };
    }

    this.pendingDiscount.set(productCode, result);
    return result;
  }

  async applyDiscount(productCode: string, pct: number): Promise<DriverResult> {
    const n = await this.evalRaw(`
      var n = null;
      for (var i = 1; i <= ${this.itemCount}; i++) {
        var nn = String(i).padStart(2,'0');
        if (document.getElementById('CK_PRODUTO'+nn)?.value === ${JSON.stringify(productCode)}) { n = nn; break; }
      }
      n || ''
    `);

    if (!n)
      return {
        status: 'error',
        summary: `Produto ${productCode} não encontrado`,
      };

    const pending = this.pendingDiscount.get(productCode);
    const whichDesc = pending?.whichDesc ?? 2;

    // Open apply discount modal
    await this.evalRaw(`descPolimento('${n}'); 'ok'`);
    await this.waitFor(`document.querySelector('.modal.in')`, 3000);

    // Portal expects integer "basis points × 100": 15% → "1500", which it formats to "15,00%"
    const pctStr = String(Math.round(pct * 100));

    if (whichDesc === 3) {
      // iCK_XDESC03 may be disabled via JS property (not only HTML attribute) — clear both
      await this.evalRaw(`
        (function() {
          var d3 = jQuery('#iCK_XDESC03${n}');
          if (d3.length) {
            d3.removeAttr('disabled');
            d3.prop('disabled', false);
            d3.removeAttr('readonly');
            d3.val(${JSON.stringify(pctStr)}).trigger('change');
            d3.focus().blur();
          }
          vldDesc('${n}');
        })();
        'done'
      `);
    } else {
      // Desconto 02 field is enabled by default
      await this.evalRaw(`
        (function() {
          var d2 = jQuery('#iCK_XDESC02${n}');
          if (d2.length) {
            d2.val(${JSON.stringify(pctStr)}).trigger('change');
            d2.focus().blur();
          }
          vldDesc('${n}');
        })();
        'done'
      `);
    }

    // Click OK
    await this.evalRaw(
      `document.querySelector('.modal.in button[data-bb-handler="sucess"]')?.click(); 'ok'`,
    );
    await this.waitFor(`!document.querySelector('.modal.in')`, 3000);

    this.pendingDiscount.delete(productCode);
    return {
      status: 'success',
      summary: `Desconto ${pct}% aplicado em ${productCode} (Desc0${whichDesc})`,
    };
  }

  async readOrderTotal(): Promise<DriverResult<number>> {
    const raw = await this.evalRaw(
      `document.getElementById('TOTAL_ORC')?.value || '0'`,
    );
    return {
      status: 'success',
      summary: `Total do pedido: ${raw}`,
      data: parseBRL(raw),
    };
  }

  async setParcelas(plan: ParcelaPlan): Promise<DriverResult> {
    const code = PARCELAS_CODE[plan.label];
    if (!code) {
      return {
        status: 'error',
        summary: `Condição de pagamento não mapeada: "${plan.label}"`,
      };
    }

    // Wait for UI clear before setting (it may be busy computing totals)
    await this.waitFor(
      `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
      10000,
    );

    await this.evalRaw(`
      (function() {
        var el = jQuery('#CJ_CONDPAG');
        el.val(${JSON.stringify(code)}).trigger('change');
        el.focus().blur();
      })();
      'done'
    `);

    // Recalculating totals often follows payment term change
    await this.waitFor(
      `!document.querySelector('.blockUI, .modal-backdrop, .modal.in')`,
      10000,
    );

    return {
      status: 'success',
      summary: `Parcelas: ${plan.label} (código ${code})`,
    };
  }

  async save(): Promise<DriverResult> {
    await this.evalRaw(
      `document.getElementById('btSalvar').click(); 'clicked'`,
    );
    await this.waitLoad();
    return {
      status: 'success',
      summary: 'Orçamento Roberlo salvo com sucesso',
    };
  }

  async captureScreenshot(path: string): Promise<DriverResult> {
    const result = await this.runner(['screenshot', path]);
    if (result.code !== 0) {
      return {
        status: 'error',
        summary: `Falha ao capturar screenshot: ${result.stderr.trim()}`,
      };
    }
    return {
      status: 'success',
      summary: `Screenshot salvo em ${path}`,
    };
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
      return {
        status: 'error',
        summary: `Falha ao exportar orçamento: ${(e as Error).message}`,
      };
    }
  }
}
