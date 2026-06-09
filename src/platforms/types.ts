// src/platforms/types.ts
export type Platform = 'autoamerica' | 'roberlo';

export interface ParcelaPlan {
  label: string;
}

export interface PlatformConfig {
  id: Platform;
  url: string;
  tipoOrcamento: string;
  tabelaPrecos?: string;
  transportadora: string;
  frete: 'CIF' | 'FOB';
  minOrderValue: number;
  /** Per-line discount % from box count (AA). Returns 0 when none applies. */
  computeLineDiscount(boxes: number): number;
  /** Installment plan from the order total. */
  computeParcelas(total: number): ParcelaPlan;
}

export interface ProductOption {
  code: string;
  name: string;
}

export interface ClientOption {
  code: string;
  name: string;
}

export interface PriceTableOption {
  code: string;
  name: string;
}

export interface ExportedQuote {
  /** Conteúdo do PDF do orçamento, codificado em base64. */
  pdfBase64: string;
  /** Número do orçamento exibido na listagem (ex.: "098171"). */
  orcamentoNumber: string;
  /** Nome do cliente como aparece na listagem (coluna "Nome"). */
  clientName: string;
}

export interface StartQuoteOpts {
  client?: string;
  tipo: string;
  tabelaPrecos?: string;
  transportadora: string;
  frete: string;
}

export interface DriverResult<T = unknown> {
  status: 'success' | 'warning' | 'error';
  summary: string;
  data?: T;
  next_actions?: string[];
}

export interface IPortalDriver {
  login(): Promise<DriverResult>;
  searchClients?(terms: string): Promise<DriverResult<ClientOption[]>>;
  selectClient?(code: string): Promise<DriverResult>;
  listPriceTables?(): Promise<DriverResult<PriceTableOption[]>>;
  selectPriceTable?(code: string): Promise<DriverResult>;
  startQuote(opts: StartQuoteOpts): Promise<DriverResult>;
  searchProducts(terms: string): Promise<DriverResult<ProductOption[]>>;
  /** Read units-per-box for a product directly from the portal. Optional: not all portals expose this. */
  readUnitsPerBox?(productCode: string): Promise<number | undefined>;
  addLine(productCode: string, units: number): Promise<DriverResult>;
  /** Update the quantity of an already-added line in place (for minimum-value bumps). */
  updateLine(productCode: string, units: number): Promise<DriverResult>;
  readLinePrice(
    productCode: string,
  ): Promise<DriverResult<{ unit: number; total: number }>>;
  applyDiscount(productCode: string, pct: number): Promise<DriverResult>;
  readOrderTotal(): Promise<DriverResult<number>>;
  setParcelas(plan: ParcelaPlan): Promise<DriverResult>;
  save(): Promise<DriverResult>;
  /** Exporta (baixa o PDF) do orçamento recém-criado, lendo a 1ª linha da listagem. */
  exportQuote(): Promise<DriverResult<ExportedQuote>>;
  /** Captura screenshot da página atual para validação visual. */
  captureScreenshot?(path: string): Promise<DriverResult>;
  /** Fecha recursos do driver (ex: encerrar processo do browser se aplicável). */
  close?(): Promise<void>;
}
