import type { OrderLine } from './order.js';
import { toSiteUnits } from './quantity.js';
import type { AliasRepository } from '../db/alias-repository.js';
import type { Prompter } from '../io/prompt.js';
import type { IPortalDriver, Platform } from '../platforms/types.js';

export interface ResolvedLine {
  name: string;
  productCode: string;
  productName: string;
  unitsPerBox: number;
  requested?: OrderLine['quantity'];
  siteUnits: number;
  boxes: number;
  resolvedFrom: 'cache' | 'interactive';
  source: 'order' | 'rule';
}

export interface ResolveDeps {
  platform: Platform;
  repo: AliasRepository;
  driver: IPortalDriver;
  prompter: Prompter;
  interactive?: boolean;
}

export async function resolveLine(
  line: OrderLine,
  deps: ResolveDeps,
): Promise<ResolvedLine> {
  const { platform, repo, driver, prompter, interactive = true } = deps;

  const cached =
    repo.find(platform, line.name) ?? repo.findFuzzy(platform, line.name);
  if (cached) {
    return build(
      line,
      cached.productCode,
      cached.productName,
      cached.unitsPerBox,
    );
  }

  if (!interactive) {
    throw new Error(
      `Produto não encontrado em modo não-interativo: "${line.name}"`,
    );
  }

  // Miss -> interactive resolution (live search on the portal).
  let terms = line.name;
  for (;;) {
    const res = await driver.searchProducts(terms);
    const options = res.data ?? [];
    const picked = await prompter.choose(
      `Produto não encontrado: "${line.name}". Resultados para "${terms}":`,
      options,
    );
    if (picked) {
      let detected: number | undefined;
      if (typeof driver.readUnitsPerBox === 'function') {
        try {
          detected = await driver.readUnitsPerBox(picked.code);
        } catch {
          detected = undefined;
        }
      }
      const unitsPerBox =
        detected ??
        (await prompter.askInt(
          `Quantas unidades = 1 caixa de "${picked.name}"?`,
        ));
      repo.save({
        platform,
        aliases: [line.name],
        productCode: picked.code,
        productName: picked.name,
        unitsPerBox,
      });
      return build(line, picked.code, picked.name, unitsPerBox, 'interactive');
    }
    terms = await prompter.ask('Digite novos termos de busca:');
  }
}

function build(
  line: OrderLine,
  code: string,
  name: string,
  unitsPerBox: number,
  resolvedFrom: 'cache' | 'interactive' = 'cache',
  source: 'order' | 'rule' = 'order',
): ResolvedLine {
  const siteUnits = toSiteUnits(line.quantity, unitsPerBox);
  return {
    name: line.name,
    productCode: code,
    productName: name,
    unitsPerBox,
    requested: line.quantity,
    siteUnits,
    boxes: Math.ceil(siteUnits / unitsPerBox),
    resolvedFrom,
    source,
  };
}
