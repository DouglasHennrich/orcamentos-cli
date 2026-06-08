// src/orcamento/orchestrator.ts
import type { PlatformConfig, IPortalDriver } from '../platforms/types.js';
import type { Prompter } from '../io/prompt.js';
import type { OrderLine } from './order.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { ExportWriter } from '../io/export-writer.js';
import { resolveLine, type ResolvedLine } from './resolver.js';

export interface RunOrcamentoInput {
  platform: PlatformConfig;
  client: string;
  orderLines: OrderLine[];
  driver: IPortalDriver;
  prompter: Prompter;
  repo: AliasRepository;
  exportWriter: ExportWriter;
}

export interface RunOrcamentoResult { total: number; parcelas: string; exportPath: string; }

const MAX_BUMP_ITERATIONS = 1000;

export async function runOrcamento(input: RunOrcamentoInput): Promise<RunOrcamentoResult> {
  const { platform, client, orderLines, driver, prompter, repo, exportWriter } = input;

  await driver.login();
  await driver.startQuote({
    client,
    tipo: platform.tipoOrcamento,
    ...(platform.tabelaPrecos !== undefined ? { tabelaPrecos: platform.tabelaPrecos } : {}),
    transportadora: platform.transportadora,
    frete: platform.frete,
  });

  // Resolve after startQuote: browser is now on the quote form, so searchProducts
  // can read the pre-loaded product select options (CK_PRODUTO01).
  // Sequential (not parallel) so readline prompts don't overlap.
  const lines: ResolvedLine[] = [];
  for (const l of orderLines) {
    lines.push(await resolveLine(l, { platform: platform.id, repo, driver, prompter }));
  }

  // Add all lines in units.
  const boxes = new Map<string, number>();
  for (const l of lines) {
    await driver.addLine(l.productCode, l.siteUnits);
    boxes.set(l.productCode, l.boxes);
  }

  // Minimum-value loop: ask the user which line to bump (1 box per step).
  let total = (await driver.readOrderTotal()).data ?? 0;
  let iterations = 0;
  while (total < platform.minOrderValue) {
    if (++iterations > MAX_BUMP_ITERATIONS) {
      throw new Error('Loop de valor-mínimo excedeu o limite de iterações.');
    }
    const indices = await prompter.askInts(
      `Total ${total.toFixed(2)} < mínimo ${platform.minOrderValue}. Qual produto aumentar (1 caixa)?\n` +
      lines.map((l, i) => `${i + 1}) ${l.productCode} - ${l.productName} (${boxes.get(l.productCode)} cx)`).join('\n'),
    );
    let anyValid = false;
    for (const idx of indices) {
      const target = lines[idx - 1];
      if (!target) continue;
      const newBoxes = (boxes.get(target.productCode) ?? 0) + 1;
      boxes.set(target.productCode, newBoxes);
      await driver.updateLine(target.productCode, newBoxes * target.unitsPerBox);
      anyValid = true;
    }
    if (anyValid) {
      total = (await driver.readOrderTotal()).data ?? total;
    }
  }

  // Discounts.
  for (const l of lines) {
    const b = boxes.get(l.productCode) ?? 0;
    if (platform.id === 'autoamerica') {
      const pct = platform.computeLineDiscount(b);
      if (pct > 0) await driver.applyDiscount(l.productCode, pct);
    } else if (platform.id === 'roberlo' && 'readMaxDiscount' in driver) {
      const pct = (await (driver as unknown as {
        readMaxDiscount(code: string): Promise<{ data?: number }>;
      }).readMaxDiscount(l.productCode)).data ?? 0;
      if (pct > 0) await driver.applyDiscount(l.productCode, pct);
    }
  }

  // Parcelas + save.
  total = (await driver.readOrderTotal()).data ?? total;
  const plan = platform.computeParcelas(total);
  await driver.setParcelas(plan);
  await driver.save();

  // Export obrigatório: baixa o PDF do orçamento recém-salvo da listagem.
  const exported = await driver.exportQuote();
  if (exported.status !== 'success' || !exported.data) {
    throw new Error(
      `Falha no export obrigatório do orçamento (já salvo na listagem): ${exported.summary}`,
    );
  }
  const exportPath = await exportWriter({
    platform: platform.id,
    clientName: exported.data.clientName,
    pdfBase64: exported.data.pdfBase64,
  });

  return { total, parcelas: plan.label, exportPath };
}
