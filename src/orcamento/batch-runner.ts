import fs from 'node:fs/promises';
import pLimit from 'p-limit';
import { autoamerica } from '../platforms/autoamerica.js';
import { roberlo } from '../platforms/roberlo.js';
import { AutoAmericaDriver } from '../platforms/autoamerica-driver.js';
import { RoberloDriver } from '../platforms/roberlo-driver.js';
import { realRunner, headedRunner } from '../platforms/agent-browser-runner.js';
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
  headed?: boolean;
  dryRun?: boolean;
}

export interface BatchSummary {
  results: {
    filePath: string; // label: "arquivo.json" or "arquivo.json[2]" for array items
    status: 'success' | 'error';
    result?: RunOrcamentoResult;
    error?: string;
  }[];
  totalSuccess: number;
  totalErrors: number;
}

interface OrderTask {
  label: string;
  data: unknown;
}

async function expandFiles(
  files: string[],
  errors?: { file: string; error: Error }[],
): Promise<OrderTask[]> {
  const tasks: OrderTask[] = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      errors?.push({
        file: filePath,
        error: new Error(`Invalid JSON in ${filePath}`),
      });
      continue;
    }
    if (Array.isArray(parsed)) {
      parsed.forEach((item, i) =>
        tasks.push({ label: `${filePath}[${i}]`, data: item }),
      );
    } else {
      tasks.push({ label: filePath, data: parsed });
    }
  }
  return tasks;
}

async function processTask(
  task: OrderTask,
  options: BatchOptions,
): Promise<{
  label: string;
  status: 'success' | 'error';
  result?: RunOrcamentoResult;
  error?: string;
}> {
  try {
    const data = task.data as Record<string, unknown>;

    if (!data.provider) {
      throw new Error('Campo "provider" é obrigatório no JSON do pedido.');
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

    const runner = options.headed ? headedRunner : realRunner;
    const driver =
      provider === 'autoamerica'
        ? new AutoAmericaDriver(runner, user, pass)
        : new RoberloDriver(runner, user, pass);

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
      ...(options.dryRun ? { dryRun: true } : {}),
    });

    return { label: task.label, status: 'success', result };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { label: task.label, status: 'error', error: msg };
  }
}

export async function runBatch(
  files: string[],
  options: BatchOptions,
): Promise<BatchSummary> {
  const expandErrors: { file: string; error: Error }[] = [];
  const tasks = await expandFiles(files, expandErrors);
  const limit = pLimit(options.concurrency ?? 3);

  const taskResults = await Promise.all(
    tasks.map((task) => limit(() => processTask(task, options))),
  );

  const expandErrorResults = expandErrors.map((e) => ({
    filePath: e.file,
    status: 'error' as const,
    error: e.error.message,
  }));

  const allResults = [
    ...expandErrorResults,
    ...taskResults.map((r) => ({ ...r, filePath: r.label })),
  ];

  return {
    results: allResults,
    totalSuccess: allResults.filter((r) => r.status === 'success').length,
    totalErrors: allResults.filter((r) => r.status === 'error').length,
  };
}
