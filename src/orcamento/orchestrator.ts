// src/orcamento/orchestrator.ts
import { mkdir, rename } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { PlatformConfig, IPortalDriver } from '../platforms/types.js';
import type { Prompter } from '../io/prompt.js';
import type { OrderLine } from './order.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { ClientRepository } from '../db/client-repository.js';
import type { ProductRuleRepository } from '../db/product-rule-repository.js';
import type { ExportWriter } from '../io/export-writer.js';
import { sanitizeFileName } from '../io/export-writer.js';
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
  /** Optional label representing the source order file or array item. */
  requestLabel?: string;
  interactive?: boolean;
  dryRun?: boolean;
  screenshotPath?: string;
  autoScreenshotDir?: string;
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
    requestLabel,
    interactive = true,
    dryRun = false,
    screenshotPath,
    autoScreenshotDir,
  } = input;

  const resolveScreenshotDestination = (target: string, label: string) => {
    const resolved = resolve(target);
    const ext = extname(resolved).toLowerCase();
    if (ext === '.png') return resolved;
    if (ext) return `${resolved}.png`;
    return join(resolved, `${sanitizeFileName(label)}.png`);
  };

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
          resolvedFrom: 'cache',
          source: 'rule',
        });
      }
    }

    const isDuplicateAddError = (summary = '') =>
      /já existe|ja existe|already exists|produto.*existe|produto .* já.*existe/i.test(
        summary,
      );

    // Add all lines in units.
    const boxes = new Map<string, number>();
    const duplicateRuleLines: string[] = [];
    const duplicateOrderLines: string[] = [];
    const addLineFailures: string[] = [];
    for (const l of lines) {
      console.log(
        `Adicionando ${l.productCode} (${l.productName}) [origem: ${l.resolvedFrom ?? 'cache'}]`,
      );
      const addResult = await driver.addLine(l.productCode, l.siteUnits);
      if (addResult.status === 'error') {
        const duplicate = isDuplicateAddError(addResult.summary);
        if (duplicate && l.source === 'rule') {
          duplicateRuleLines.push(`${l.productCode} - ${l.productName}`);
          continue;
        }
        if (duplicate && l.source === 'order') {
          duplicateOrderLines.push(`${l.productCode} - ${l.productName}`);
          continue;
        }
        console.warn(
          `Aviso: falha ao adicionar produto ${l.productCode} (${l.productName}): ${addResult.summary}`,
        );
        addLineFailures.push(
          `${l.productCode} - ${l.productName}: ${addResult.summary}`,
        );
        continue;
      }
      boxes.set(l.productCode, l.boxes);
    }

    if (addLineFailures.length > 0) {
      console.warn(
        `\nAtenção: ${addLineFailures.length} produto(s) não foram adicionados ao orçamento:\n` +
          addLineFailures.map((p) => `  - ${p}`).join('\n'),
      );
    }

    let total = (await driver.readOrderTotal()).data ?? 0;

    // Discounts — only for products successfully added.
    for (const l of lines) {
      if (!boxes.has(l.productCode)) continue;
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
            b >= r.quantityValue &&
            (r.productCode === '*' || r.productCode === l.productCode),
        )
        .sort((a, b) => {
          const aSpecific = a.productCode === l.productCode;
          const bSpecific = b.productCode === l.productCode;
          if (aSpecific !== bSpecific) return aSpecific ? -1 : 1;
          return (b.discountPct ?? 0) - (a.discountPct ?? 0);
        });

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

    // Minimum check & bump.
    let iterations = 0;
    while (total < platform.minOrderValue) {
      if (iterations++ > MAX_BUMP_ITERATIONS) {
        throw new Error(
          `Loop infinito detectado ao aumentar produtos para o mínimo (${platform.minOrderValue}).`,
        );
      }

      if (!interactive) {
        throw new Error(
          `Total (R$ ${total.toFixed(2)}) abaixo do mínimo (R$ ${platform.minOrderValue}) e requer intervenção manual.`,
        );
      }

      console.log(
        `Total (R$ ${total.toFixed(2)}) abaixo do mínimo (R$ ${platform.minOrderValue}).`,
      );

      const bumpOptions = lines.filter((l) => boxes.has(l.productCode));
      if (bumpOptions.length === 0) {
        throw new Error(
          'Total abaixo do mínimo e nenhum produto disponível para aumentar.',
        );
      }

      const choice = await prompter.choose(
        'Escolha um produto para aumentar (1 caixa):',
        bumpOptions.map((l) => ({
          code: l.productCode,
          name: `${l.productName} - ${boxes.get(l.productCode)} cx atual`,
        })),
      );

      if (!choice) {
        throw new Error('Processo interrompido pelo usuário.');
      }

      const line = bumpOptions.find((l) => l.productCode === choice.code)!;
      const currentBoxes = boxes.get(line.productCode) ?? 0;
      const newBoxes = currentBoxes + 1;
      const newUnits = newBoxes * line.unitsPerBox;

      const addResult = await driver.addLine(line.productCode, newUnits);
      if (addResult.status === 'error') {
        console.error(
          `Falha ao aumentar ${line.productCode}: ${addResult.summary}`,
        );
        break;
      }

      boxes.set(line.productCode, newBoxes);
      total = (await driver.readOrderTotal()).data ?? total;
    }

    // Parcelas + save.
    total = (await driver.readOrderTotal()).data ?? total;
    const plan = platform.computeParcelas(total);
    await driver.setParcelas(plan);

    const hasExplicitScreenshot = Boolean(screenshotPath);
    const requestedLabel = requestLabel ?? client;
    const effectiveScreenshotPath = screenshotPath
      ? resolveScreenshotDestination(screenshotPath, requestedLabel)
      : autoScreenshotDir
        ? resolveScreenshotDestination(
            resolve(autoScreenshotDir, platform.id),
            requestedLabel,
          )
        : undefined;

    if (!dryRun && effectiveScreenshotPath) {
      if (!driver.captureScreenshot) {
        console.warn(
          'Aviso: driver não oferece suporte a captura de screenshot.',
        );
      } else {
        await mkdir(dirname(effectiveScreenshotPath), { recursive: true });
        const screenshotResult = await driver.captureScreenshot(
          effectiveScreenshotPath,
        );
        if (screenshotResult.status === 'error') {
          console.warn(
            `Aviso: falha ao capturar screenshot final: ${screenshotResult.summary}`,
          );
        } else {
          console.log(`Screenshot final salvo em: ${effectiveScreenshotPath}`);
        }
      }
    }

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
      ...(requestLabel ? { label: requestLabel } : {}),
      pdfBase64: exported.data.pdfBase64,
    });

    if (
      !hasExplicitScreenshot &&
      effectiveScreenshotPath &&
      exportPath.toLowerCase().endsWith('.pdf')
    ) {
      const desiredScreenshotPath = exportPath.replace(/\.pdf$/i, '.png');
      if (desiredScreenshotPath !== effectiveScreenshotPath) {
        try {
          // Safety check: ensure we are not overwriting a non-pdf file
          if (!exportPath.toLowerCase().endsWith('.pdf')) {
            throw new Error('Export path does not end with .pdf');
          }

          await mkdir(dirname(desiredScreenshotPath), { recursive: true });
          await rename(effectiveScreenshotPath, desiredScreenshotPath);
          console.log(`Screenshot movida para: ${desiredScreenshotPath}`);
        } catch {
          // Non-fatal: if rename fails, keep the original screenshot path.
        }
      }
    }

    return { total, parcelas: plan.label, exportPath };
  } finally {
    if (driver.close) {
      await driver.close();
    }
  }
}
