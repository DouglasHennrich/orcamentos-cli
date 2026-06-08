#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { program } from 'commander';
import { parseOrder } from '../orcamento/order.js';
import { runOrcamento } from '../orcamento/orchestrator.js';
import { AliasRepository } from '../db/alias-repository.js';
import { ProductRuleRepository } from '../db/product-rule-repository.js';
import { ConsolePrompter } from '../io/prompt.js';
import { makeExportWriter } from '../io/export-writer.js';
import { runRulesEditor } from './rules-editor.js';
import { realRunner } from '../platforms/agent-browser-runner.js';
import { AutoAmericaDriver } from '../platforms/autoamerica-driver.js';
import { RoberloDriver } from '../platforms/roberlo-driver.js';
import { autoamerica } from '../platforms/autoamerica.js';
import { roberlo } from '../platforms/roberlo.js';
import type { Platform } from '../platforms/types.js';

import { runBatch } from '../orcamento/batch-runner.js';
import Table from 'cli-table3';

const DEFAULT_DB_PATH = resolve(process.env.ALIAS_DB_PATH ?? 'aliases.db');

program
  .name('agent-orcamento')
  .description(
    'Gerador automático de orçamentos nos portais Auto America e Roberlo',
  );

program
  .command('run')
  .description('Gera orçamentos a partir de arquivos de pedido JSON')
  .option(
    '-o, --order <paths...>',
    'Caminho(s) para os arquivos de pedido JSON',
  )
  .option(
    '-c, --concurrency <n>',
    'Número de orçamentos em paralelo (padrão: 3)',
    '3',
  )
  .option(
    '--db <path>',
    'Caminho para o banco de dados de aliases',
    DEFAULT_DB_PATH,
  )
  .action(
    async (opts: { order?: string[]; concurrency: string; db: string }) => {
      if (!opts.order || opts.order.length === 0) {
        console.error(
          'Pelo menos um arquivo de pedido deve ser fornecido via --order',
        );
        process.exit(1);
      }

      const repo = new AliasRepository(opts.db);
      const ruleRepo = new ProductRuleRepository(opts.db);
      const prompter = new ConsolePrompter();
      const exportWriter = makeExportWriter();

      const concurrency = parseInt(opts.concurrency, 10) || 3;
      const interactive = opts.order.length === 1 && concurrency === 1;

      try {
        console.log(
          `Iniciando processamento de ${opts.order.length} orçamentos (paralelismo: ${concurrency})...\n`,
        );

        const summary = await runBatch(opts.order, {
          prompter,
          repo,
          ruleRepo,
          exportWriter,
          concurrency,
          interactive,
        });

        // Show summary table
        const table = new Table({
          head: ['Arquivo', 'Status', 'Total', 'Exportado'],
          style: { head: ['cyan'] },
        });

        for (const res of summary.results) {
          if (res.status === 'success' && res.result) {
            table.push([
              res.filePath,
              '✅ OK',
              `R$ ${res.result.total.toFixed(2).replace('.', ',')}`,
              res.result.exportPath,
            ]);
          } else {
            table.push([
              res.filePath,
              '❌ ERRO',
              '-',
              res.error || 'Erro desconhecido',
            ]);
          }
        }

        console.log(table.toString());
        console.log(
          `\nFinalizado: ${summary.totalSuccess} sucesso(s), ${summary.totalErrors} erro(s).`,
        );

        if (summary.totalErrors > 0) {
          process.exitCode = 1;
        }
      } catch (e) {
        console.error(`\nErro fatal no batch: ${(e as Error).message}`);
        process.exitCode = 1;
      } finally {
        prompter.close();
        repo.close();
        ruleRepo.close();
      }
    },
  );

program
  .command('rules')
  .description(
    'Gerencia as regras de produtos (add-product e override-discount)',
  )
  .option(
    '--db <path>',
    'Caminho para o banco de dados de regras',
    DEFAULT_DB_PATH,
  )
  .action(async (opts: { db: string }) => {
    const repo = new ProductRuleRepository(opts.db);
    try {
      await runRulesEditor(repo);
    } catch (e) {
      if ((e as Error).message !== '') {
        console.error(`\nErro: ${(e as Error).message}`);
      }
    } finally {
      repo.close();
    }
  });

program.parse();
