// src/orcamento/orchestrator.ts
import type { PlatformConfig, IPortalDriver } from '../platforms/types.js';
import type { Prompter } from '../io/prompt.js';
import type { OrderLine } from './order.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { ClientRepository } from '../db/client-repository.js';
import type { ProductRuleRepository } from '../db/product-rule-repository.js';
import type { ExportWriter } from '../io/export-writer.js';
import { resolveLine, type ResolvedLine } from './resolver.js';
import { toSiteUnits } from './quantity.js';
import { resolveClient, resolvePriceTable } from './client-resolver.js';

export interface RunOrcamentoInput {
  platform: PlatformConfig;
  client: string;
  orderLines: OrderLine[];
  driver: IPortalDriver;
  prompter: Prompter;
  repo: AliasRepository;
  clientRepo: ClientRepository;
  ruleRepo: ProductRuleRepository;
  exportWriter: ExportWriter;
  interactive?: boolean;
  dryRun?: boolean;
}

export interface RunOrcamentoResult {
  total: number;
  parcelas: string;
  exportPath: string;
}

const MAX_BUMP_ITERATIONS = 1000;

export async function runOrcamento(
  input: RunOrcamentoInput,
): Promise<RunOrcamentoResult> {
  const {
    platform,
    client,
    orderLines,
    driver,
    prompter,
    repo,
    clientRepo,
    ruleRepo,
    exportWriter,
    interactive = true,
    dryRun = false,
  } = input;

  try {
    await driver.login();
    await driver.startQuote({
      tipo: platform.tipoOrcamento,
      transportadora: platform.transportadora,
      frete: platform.frete,
    });

    await resolveClient(client, {
      driver,
      platform,
      prompter,
      repo: clientRepo,
      interactive,
    });

    await resolvePriceTable({
      driver,
      platform,
      prompter,
      repo: clientRepo,
      interactive,
    });

    const rules = ruleRepo.listByProvider(platform.id).filter((r) => r.enabled);
    if (rules.length > 0 && interactive) {
      console.log(`Regras ativas (${platform.id}):`);
      for (const r of rules) {
        if (r.type === 'add-product') {
          console.log(
            `  - ADICIONAR: ${r.productCode} (${r.quantityValue} ${r.quantityUnit})`,
          );
        } else if (r.type === 'override-discount') {
          console.log(
            `  - DESCONTO FIXO: ${r.productCode} (${r.discountPct}%)`,
          );
        }
      }
      const thresholds = rules
        .filter((r) => r.type === 'threshold-discount')
        .sort((a, b) => (a.quantityValue ?? 0) - (b.quantityValue ?? 0));

      if (thresholds.length > 0) {
        const tiers = thresholds
          .map((r) => `>=${r.quantityValue} cx -> ${r.discountPct}%`)
          .join(', ');
        console.log(`  - DESCONTO POR QUANTIDADE: ${tiers}`);
      }
    }

    // Resolve after startQuote: browser is now on the quote form, so searchProducts
    // can read the pre-loaded product select options (CK_PRODUTO01).
    // Sequential (not parallel) so readline prompts don't overlap.
    const lines: ResolvedLine[] = [];
    for (const l of orderLines) {
      lines.push(
        await resolveLine(l, {
          platform: platform.id,
          repo,
          driver,
          prompter,
          interactive,
        }),
      );
    }

    // Inject add-product rules.
    for (const rule of rules) {
      if (rule.type !== 'add-product') continue;

      const existing = lines.find((l) => l.productCode === rule.productCode);
      const ruleUnits = toSiteUnits(
        { value: rule.quantityValue!, unit: rule.quantityUnit! },
        rule.unitsPerBox || 1,
      );

      if (existing) {
        existing.siteUnits += ruleUnits;
        existing.boxes = Math.ceil(existing.siteUnits / existing.unitsPerBox);
      } else {
        lines.push({
          name: `REGRA:${rule.productCode}`,
          productCode: rule.productCode,
          productName: rule.productName || `Produto ${rule.productCode}`,
          unitsPerBox: rule.unitsPerBox || 1,
          siteUnits: ruleUnits,
          boxes: Math.ceil(ruleUnits / (rule.unitsPerBox || 1)),
        });
      }
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
      if (!interactive) {
        throw new Error(
          `Total ${total.toFixed(
            2,
          )} < mínimo ${platform.minOrderValue}. Orçamento requer intervenção manual em modo não-interativo.`,
        );
      }
      const indices = await prompter.askInts(
        `Total ${total.toFixed(2)} < mínimo ${
          platform.minOrderValue
        }. Qual produto aumentar (1 caixa)?\n` +
          lines
            .map(
              (l, i) =>
                `${i + 1}) ${l.productCode} - ${l.productName} (${boxes.get(l.productCode)} cx)`,
            )
            .join('\n'),
      );
      let anyValid = false;
      for (const idx of indices) {
        const target = lines[idx - 1];
        if (!target) continue;
        const newBoxes = (boxes.get(target.productCode) ?? 0) + 1;
        boxes.set(target.productCode, newBoxes);
        await driver.updateLine(
          target.productCode,
          newBoxes * target.unitsPerBox,
        );
        anyValid = true;
      }
      if (anyValid) {
        total = (await driver.readOrderTotal()).data ?? total;
      }
    }

    // Discounts.
    for (const l of lines) {
      const b = boxes.get(l.productCode) ?? 0;

      // Rules: override-discount takes precedence.
      const override = rules.find(
        (r) =>
          r.type === 'override-discount' && r.productCode === l.productCode,
      );
      if (override) {
        if (override.discountPct !== undefined) {
          await driver.applyDiscount(l.productCode, override.discountPct);
        }
        continue;
      }

      // Rules: threshold-discount (min boxes tiers).
      const thresholdRules = rules
        .filter(
          (r) =>
            r.type === 'threshold-discount' &&
            r.quantityValue !== undefined &&
            b >= r.quantityValue,
        )
        .sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));

      if (thresholdRules.length > 0) {
        const bestTier = thresholdRules[0];
        if (bestTier?.discountPct !== undefined) {
          await driver.applyDiscount(l.productCode, bestTier.discountPct);
        }
        continue;
      }

      if (platform.id === 'autoamerica') {
        const pct = platform.computeLineDiscount(b);
        if (pct > 0) await driver.applyDiscount(l.productCode, pct);
      } else if (platform.id === 'roberlo' && 'readMaxDiscount' in driver) {
        const pct =
          (
            await (
              driver as unknown as {
                readMaxDiscount(code: string): Promise<{ data?: number }>;
              }
            ).readMaxDiscount(l.productCode)
          ).data ?? 0;
        if (pct > 0) await driver.applyDiscount(l.productCode, pct);
      }
    }

    // Parcelas + save.
    total = (await driver.readOrderTotal()).data ?? total;
    const plan = platform.computeParcelas(total);
    await driver.setParcelas(plan);

    if (dryRun) {
      console.log(
        `\nSimulação concluída (não salvo). Total: R$ ${total.toFixed(2).replace('.', ',')}`,
      );
      return { total, parcelas: plan.label, exportPath: '(simulação)' };
    }

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
  } finally {
    if (driver.close) {
      await driver.close();
    }
  }
}
