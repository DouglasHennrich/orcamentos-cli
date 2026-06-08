#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { program } from 'commander';
import { parseOrder } from '../orcamento/order.js';
import { runOrcamento } from '../orcamento/orchestrator.js';
import { AliasRepository } from '../db/alias-repository.js';
import { ConsolePrompter } from '../io/prompt.js';
import { makeExportWriter } from '../io/export-writer.js';
import { realRunner } from '../platforms/agent-browser-runner.js';
import { AutoAmericaDriver } from '../platforms/autoamerica-driver.js';
import { RoberloDriver } from '../platforms/roberlo-driver.js';
import { autoamerica } from '../platforms/autoamerica.js';
import { roberlo } from '../platforms/roberlo.js';
import type { Platform } from '../platforms/types.js';

const DEFAULT_DB_PATH = resolve(process.env.ALIAS_DB_PATH ?? 'aliases.db');

program
  .name('agent-orcamento')
  .description('Gerador automático de orçamentos nos portais Auto America e Roberlo');

program
  .command('run')
  .description('Gera um orçamento a partir de um arquivo de pedido JSON')
  .requiredOption('-p, --platform <platform>', 'Portal alvo: autoamerica | roberlo')
  .requiredOption('-o, --order <path>', 'Caminho para o arquivo de pedido JSON')
  .option('--db <path>', 'Caminho para o banco de dados de aliases', DEFAULT_DB_PATH)
  .action(async (opts: { platform: string; order: string; db: string }) => {
    const platform = opts.platform as Platform;
    if (platform !== 'autoamerica' && platform !== 'roberlo') {
      console.error(`Plataforma inválida: "${opts.platform}". Use: autoamerica | roberlo`);
      process.exit(1);
    }

    // Load and parse order file
    let orderJson: unknown;
    try {
      orderJson = JSON.parse(readFileSync(resolve(opts.order), 'utf-8'));
    } catch (e) {
      console.error(`Erro ao ler o arquivo de pedido: ${(e as Error).message}`);
      process.exit(1);
    }

    const order = parseOrder(orderJson);

    // Resolve credentials from env
    const user = platform === 'autoamerica'
      ? process.env.AUTOAMERICA_USER
      : process.env.ROBERLO_USER;
    const pass = platform === 'autoamerica'
      ? process.env.AUTOAMERICA_PASS
      : process.env.ROBERLO_PASS;

    if (!user || !pass) {
      const prefix = platform === 'autoamerica' ? 'AUTOAMERICA' : 'ROBERLO';
      console.error(`Credenciais ausentes. Defina ${prefix}_USER e ${prefix}_PASS no .env`);
      process.exit(1);
    }

    const platformConfig = platform === 'autoamerica' ? autoamerica : roberlo;
    const driver = platform === 'autoamerica'
      ? new AutoAmericaDriver(realRunner, user, pass)
      : new RoberloDriver(realRunner, user, pass);

    const repo = new AliasRepository(opts.db);
    const prompter = new ConsolePrompter();
    const exportWriter = makeExportWriter();

    try {
      const result = await runOrcamento({
        platform: platformConfig,
        client: order.client,
        orderLines: order.produtos,
        driver,
        prompter,
        repo,
        exportWriter,
      });

      console.log(`\nOrçamento gerado com sucesso!`);
      console.log(`Total: R$ ${result.total.toFixed(2).replace('.', ',')}`);
      console.log(`Parcelas: ${result.parcelas}`);
      console.log(`PDF exportado: ${result.exportPath}`);
    } catch (e) {
      console.error(`\nErro: ${(e as Error).message}`);
      process.exitCode = 1;
    } finally {
      prompter.close();
      repo.close();
    }
  });

program.parse();
