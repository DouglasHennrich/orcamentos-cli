import fs from 'node:fs/promises';
import pLimit from 'p-limit';
import { autoamerica } from '../platforms/autoamerica.js';
import { roberlo } from '../platforms/roberlo.js';
import { AutoAmericaDriver } from '../platforms/autoamerica-driver.js';
import { RoberloDriver } from '../platforms/roberlo-driver.js';
import { realRunner } from '../platforms/agent-browser-runner.js';
import type { Prompter } from '../io/prompt.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { ProductRuleRepository } from '../db/product-rule-repository.js';
import type { ExportWriter } from '../io/export-writer.js';
import { runOrcamento, type RunOrcamentoResult } from './orchestrator.js';
import { parseOrder } from './order.js';

export interface BatchOptions {
  prompter: Prompter;
  repo: AliasRepository;
  ruleRepo: ProductRuleRepository;
  exportWriter: ExportWriter;
  concurrency?: number;
  interactive?: boolean;
}

export interface BatchSummary {
  results: {
    filePath: string;
    status: 'success' | 'error';
    result?: RunOrcamentoResult;
    error?: string;
  }[];
  totalSuccess: number;
  totalErrors: number;
}

export async function runBatch(
  files: string[],
  options: BatchOptions,
): Promise<BatchSummary> {
  const limit = pLimit(options.concurrency || 1);

  const taskResults = await Promise.all(
    files.map((filePath) =>
      limit(async () => {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          if (!data.provider) {
            throw new Error(
              'Campo "provider" é obrigatório no JSON do pedido.',
            );
          }

          const provider = data.provider as 'autoamerica' | 'roberlo';
          const platform = provider === 'autoamerica' ? autoamerica : roberlo;

          const user =
            provider === 'autoamerica'
              ? process.env.AUTOAMERICA_USER
              : process.env.ROBERLO_USER;
          const pass =
            provider === 'autoamerica'
              ? process.env.AUTOAMERICA_PASS
              : process.env.ROBERLO_PASS;

          if (!user || !pass) {
            throw new Error(
              `Credenciais não configuradas no .env para o provider: ${provider}`,
            );
          }

          const driver =
            provider === 'autoamerica'
              ? new AutoAmericaDriver(realRunner, user, pass)
              : new RoberloDriver(realRunner, user, pass);

          const order = parseOrder(data);

          const result = await runOrcamento({
            platform,
            client: order.client,
            orderLines: order.produtos,
            driver,
            prompter: options.prompter,
            repo: options.repo,
            ruleRepo: options.ruleRepo,
            exportWriter: options.exportWriter,
            interactive: options.interactive ?? false,
          });

          return { filePath, status: 'success' as const, result };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { filePath, status: 'error' as const, error: msg };
        }
      }),
    ),
  );

  const summary: BatchSummary = {
    results: taskResults,
    totalSuccess: taskResults.filter((r) => r.status === 'success').length,
    totalErrors: taskResults.filter((r) => r.status === 'error').length,
  };

  return summary;
}
