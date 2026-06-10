#!/usr/bin/env node
import 'dotenv/config';
import { resolve } from 'node:path';
import { program } from 'commander';
import { AliasRepository } from '../db/alias-repository.js';
import { ClientRepository } from '../db/client-repository.js';
import { ProductRuleRepository } from '../db/product-rule-repository.js';
import { ConsolePrompter } from '../io/prompt.js';
import { makeExportWriter } from '../io/export-writer.js';
import { runRulesEditor } from './rules-editor.js';
import { runBatch } from '../orcamento/batch-runner.js';
import Table from 'cli-table3';

const DEFAULT_DB_PATH = resolve(process.env.ORCAMENTO_DB ?? 'orcamentos.db');

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
  .option('--headed', 'Abre o browser visível (útil para debug)')
  .option('--dry-run', 'Simula sem salvar o orçamento no portal')
  .option(
    '--screenshot <path>',
    'Captura screenshot final do pedido na página e salva em PNG',
  )
  .action(
    async (opts: {
      order?: string[];
      concurrency: string;
      db: string;
      headed?: boolean;
      dryRun?: boolean;
      screenshot?: string;
    }) => {
      if (!opts.order || opts.order.length === 0) {
        console.error(
          'Pelo menos um arquivo de pedido deve ser fornecido via --order',
        );
        process.exit(1);
      }

      const repo = new AliasRepository(opts.db);
      const clientRepo = new ClientRepository(opts.db);
      const ruleRepo = new ProductRuleRepository(opts.db);
      const prompter = new ConsolePrompter();
      const exportBaseDir =
        process.env.ORCAMENTO_EXPORT_DIR ?? 'public/orcamentos';
      const exportWriter = makeExportWriter(exportBaseDir);

      const concurrency = parseInt(opts.concurrency, 10) || 3;
      const interactive = opts.order.length === 1;

      try {
        console.log(
          `Iniciando processamento de ${opts.order.length} orçamentos (paralelismo: ${concurrency})...\n`,
        );

        const headed =
          opts.headed ??
          process.env.AGENT_BROWSER_HEADED?.toLowerCase() === 'true';

        const summary = await runBatch(opts.order, {
          prompter,
          repo,
          clientRepo,
          ruleRepo,
          exportWriter,
          concurrency,
          interactive,
          headed,
          autoScreenshotDir: exportBaseDir,
          ...(opts.dryRun ? { dryRun: true } : {}),
          ...(opts.screenshot ? { screenshotPath: opts.screenshot } : {}),
        });

        // Show summary table
        const table = new Table({
          head: ['Cliente', 'Status', 'Total', 'Exportado'],
          style: { head: ['cyan'] },
        });

        for (const res of summary.results) {
          if (res.status === 'success' && res.result) {
            table.push([
              res.result.client,
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
    'Gerencia as regras de produtos (add-product, override-discount e threshold-discount)',
  )
  .option(
    '--db <path>',
    'Caminho para o banco de dados de regras',
    DEFAULT_DB_PATH,
  )
  .action(async (opts: { db: string }) => {
    const repo = new ProductRuleRepository(opts.db);
    const aliasRepo = new AliasRepository(opts.db);
    try {
      await runRulesEditor(repo, aliasRepo);
    } catch (e) {
      if ((e as Error).message !== '') {
        console.error(`\nErro: ${(e as Error).message}`);
      }
    } finally {
      repo.close();
      aliasRepo.close();
    }
  });

program.parse();
