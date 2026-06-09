import type { ClientRepository } from '../db/client-repository.js';
import type { Prompter } from '../io/prompt.js';
import type {
  IPortalDriver,
  PlatformConfig,
  ClientOption,
  PriceTableOption,
} from '../platforms/types.js';

export interface ClientResolveDeps {
  platform: PlatformConfig;
  repo: ClientRepository;
  driver: IPortalDriver;
  prompter: Prompter;
  interactive?: boolean;
}

/**
 * Resolves the client from an alias, using the repository (cache) or interactive search.
 * After resolution, it selects the client using the driver.
 */
export async function resolveClient(
  alias: string,
  deps: ClientResolveDeps,
): Promise<void> {
  const { platform, repo, driver, prompter, interactive = true } = deps;

  if (!driver.selectClient || !driver.searchClients) {
    return;
  }

  const cached = repo.find(platform.id, alias);
  if (cached) {
    await driver.selectClient(cached.clientCode);
    return;
  }

  if (!interactive) {
    throw new Error(
      `Cliente não encontrado em modo não-interativo: "${alias}"`,
    );
  }

  let terms = alias;
  for (;;) {
    const res = await driver.searchClients(terms);
    const options = res.data ?? [];

    const picked = (await prompter.choose(
      `Cliente não encontrado: "${alias}". Resultados para "${terms}":`,
      options as any,
    )) as ClientOption | null;

    if (picked) {
      repo.save({
        platform: platform.id,
        aliasRaw: alias,
        clientCode: picked.code,
        clientName: picked.name,
      });
      await driver.selectClient(picked.code);
      return;
    }

    terms = await prompter.ask('Digite novos termos de busca para o cliente:');
  }
}

/**
 * Resolves the price table, using the platform default if valid,
 * or letting the user choose from a list.
 */
export async function resolvePriceTable(
  deps: ClientResolveDeps,
): Promise<void> {
  const { platform, driver, prompter, interactive = true } = deps;

  if (!driver.listPriceTables || !driver.selectPriceTable) {
    return;
  }

  const res = await driver.listPriceTables();
  const tables = res.data ?? [];

  if (tables.length === 0) {
    return;
  }

  // If there's only one table, use it automatically.
  if (tables.length === 1 && tables[0]) {
    await driver.selectPriceTable(tables[0].code);
    return;
  }

  // Use platform default if defined and valid (fuzzy match).
  if (platform.tabelaPrecos) {
    const target = platform.tabelaPrecos.toLowerCase();
    const match = tables.find(
      (t) =>
        t.name.toLowerCase() === target ||
        t.name.toLowerCase().includes(target) ||
        target.includes(t.name.toLowerCase()),
    );

    if (match) {
      await driver.selectPriceTable(match.code);
      return;
    }
  }

  if (!interactive) {
    throw new Error(
      `Múltiplas tabelas de preço encontradas e nenhuma corresponde a "${platform.tabelaPrecos}" em modo não-interativo.`,
    );
  }

  const picked = (await prompter.choose(
    'Selecione a tabela de preços:',
    tables as any,
  )) as PriceTableOption | null;

  // Use the picked table, or fallback to the first choice if "Nenhum" was selected.
  const finalTable = picked || tables[0];
  if (finalTable) {
    await driver.selectPriceTable(finalTable.code);
  }
}
