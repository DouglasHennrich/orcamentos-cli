import enquirer from 'enquirer';
import type {
  ProductRuleRepository,
  CreateProductRuleInput,
} from '../db/product-rule-repository.js';
import type { Platform } from '../platforms/types.js';

const { Select, Input, Confirm } = enquirer as any;

export async function runRulesEditor(
  repo: ProductRuleRepository,
): Promise<void> {
  const providerSelect = new Select({
    name: 'provider',
    message: 'Escolha o provider para gerenciar as regras:',
    choices: ['autoamerica', 'roberlo'],
  });

  const provider = (await providerSelect.run()) as Platform;

  for (;;) {
    const rules = repo.listByProvider(provider);

    console.log(`\n=== Regras para ${provider.toUpperCase()} ===`);
    if (rules.length === 0) {
      console.log('Nenhuma regra cadastrada.');
    } else {
      rules.forEach((r, i) => {
        const status = r.enabled
          ? '[\x1b[32mATIVA\x1b[0m]'
          : '[\x1b[31mINATIVA\x1b[0m]';
        let details = '';
        if (r.type === 'add-product') {
          details = `Adicionar ${r.productCode} (${r.productName || '?'}) -> ${r.quantityValue} ${r.quantityUnit}`;
        } else if (r.type === 'override-discount') {
          details = `Desconto fixo em ${r.productCode} (${r.productName || '?'}) -> ${r.discountPct}%`;
        } else if (r.type === 'threshold-discount') {
          details = `Desconto por quantidade: >=${r.quantityValue} cx -> ${r.discountPct}%`;
        }
        console.log(`${i + 1}. ${status} ${details}`);
      });
    }

    const mainMenu = new Select({
      name: 'action',
      message: 'O que deseja fazer?',
      choices: [
        { name: 'add', message: 'Nova Regra' },
        ...(rules.length > 0
          ? [
              { name: 'edit', message: 'Editar Regra' },
              { name: 'toggle', message: 'Alternar Ativa/Inativa' },
              { name: 'delete', message: 'Deletar Regra' },
            ]
          : []),
        { name: 'exit', message: 'Sair' },
      ],
    });

    const action = await mainMenu.run();

    if (action === 'exit') break;

    if (action === 'add') {
      await addRule(repo, provider);
    } else if (action === 'edit') {
      const idx = await pickRule(rules);
      if (idx !== -1) await editRule(repo, rules[idx]);
    } else if (action === 'toggle') {
      const idx = await pickRule(rules);
      if (idx !== -1) {
        const rule = rules[idx];
        if (rule) repo.setEnabled(rule.id, !rule.enabled);
      }
    } else if (action === 'delete') {
      const idx = await pickRule(rules);
      if (idx !== -1) {
        const rule = rules[idx];
        if (rule) {
          const confirm = new Confirm({
            message: `Tem certeza que deseja deletar a regra para ${rule.productCode}?`,
          });
          if (await confirm.run()) repo.delete(rule.id);
        }
      }
    }
  }
}

async function pickRule(rules: any[]): Promise<number> {
  const select = new Select({
    name: 'rule',
    message: 'Selecione a regra:',
    choices: rules.map((r, i) => {
      const label =
        r.type === 'threshold-discount'
          ? `>=${r.quantityValue} cx -> ${r.discountPct}%`
          : r.productCode;
      return {
        name: i.toString(),
        message: `${label} (${r.type})`,
      };
    }),
  });
  const res = await select.run();
  return parseInt(res, 10);
}

async function addRule(
  repo: ProductRuleRepository,
  provider: Platform,
): Promise<void> {
  const typeSelect = new Select({
    name: 'type',
    message: 'Tipo de regra:',
    choices: [
      { name: 'add-product', message: 'Adicionar Produto (Sempre incluir)' },
      {
        name: 'override-discount',
        message: 'Desconto Fixo (Sobrescrever automático)',
      },
      {
        name: 'threshold-discount',
        message: 'Desconto por Quantidade (Global, por nivel de caixas)',
      },
    ],
  });
  const type = (await typeSelect.run()) as
    | 'add-product'
    | 'override-discount'
    | 'threshold-discount';

  if (type === 'threshold-discount') {
    const minBoxesInput = new Input({
      message: 'Mínimo de caixas para o desconto (>=):',
      initial: '1',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1)
          return 'Mínimo deve ser um número inteiro maior que 0';
        return true;
      },
    });
    const quantityValue = parseInt(await minBoxesInput.run(), 10);

    const discInput = new Input({
      message: 'Percentual de desconto (1-100):',
      initial: '1',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 100)
          return 'O desconto deve ser entre 1 e 100%';
        return true;
      },
    });
    const discountPct = parseInt(await discInput.run(), 10);

    repo.save({
      provider,
      type,
      productCode: '*',
      quantityValue,
      discountPct,
    });
    console.log('\x1b[32mRegra de desconto por quantidade salva!\x1b[0m');
    return;
  }

  const codeInput = new Input({ message: 'Código do produto:' });
  const productCode = await codeInput.run();

  const nameInput = new Input({ message: 'Nome do produto (opcional):' });
  const productName = await nameInput.run();

  const unitsInput = new Input({
    message: 'Unidades por caixa (opcional):',
    initial: '1',
  });
  const unitsPerBox = parseInt(await unitsInput.run(), 10);

  const input: CreateProductRuleInput = {
    provider,
    type,
    productCode,
    productName,
    unitsPerBox: isNaN(unitsPerBox) ? 1 : unitsPerBox,
  };

  if (type === 'add-product') {
    const valInput = new Input({
      message: 'Quantidade (número):',
      initial: '1',
    });
    input.quantityValue = parseInt(await valInput.run(), 10);

    const unitSelect = new Select({
      name: 'unit',
      message: 'Unidade:',
      choices: ['CX', 'UN'],
    });
    input.quantityUnit = await unitSelect.run();
  } else {
    const discInput = new Input({
      message: 'Percentual de desconto (0-100):',
      initial: '0',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0 || n > 100)
          return 'O desconto deve ser entre 0 e 100%';
        return true;
      },
    });
    input.discountPct = parseInt(await discInput.run(), 10);
  }

  repo.save(input);
  console.log('\x1b[32mRegra salva com sucesso!\x1b[0m');
}

async function editRule(repo: ProductRuleRepository, rule: any): Promise<void> {
  const input: CreateProductRuleInput = {
    provider: rule.provider,
    type: rule.type,
    productCode: rule.productCode,
    productName: rule.productName,
    unitsPerBox: rule.unitsPerBox,
    quantityValue: rule.quantityValue,
    quantityUnit: rule.quantityUnit,
    discountPct: rule.discountPct,
  };

  if (rule.type === 'threshold-discount') {
    const minBoxesInput = new Input({
      message: 'Novo mínimo de caixas para o desconto (>=):',
      initial: rule.quantityValue.toString(),
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1)
          return 'Mínimo deve ser um número inteiro maior que 0';
        return true;
      },
    });
    input.quantityValue = parseInt(await minBoxesInput.run(), 10);

    const discInput = new Input({
      message: 'Novo percentual de desconto (1-100):',
      initial: rule.discountPct.toString(),
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 100)
          return 'O desconto deve ser entre 1 e 100%';
        return true;
      },
    });
    input.discountPct = parseInt(await discInput.run(), 10);
  } else if (rule.type === 'add-product') {
    const valInput = new Input({
      message: 'Nova quantidade (número):',
      initial: rule.quantityValue.toString(),
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n <= 0)
          return 'A quantidade deve ser um número positivo';
        return true;
      },
    });
    input.quantityValue = parseInt(await valInput.run(), 10);

    const unitSelect = new Select({
      name: 'unit',
      message: 'Nova unidade:',
      choices: ['CX', 'UN'],
      initial: rule.quantityUnit === 'CX' ? 0 : 1,
    });
    input.quantityUnit = await unitSelect.run();
  } else {
    const discInput = new Input({
      message: 'Novo percentual de desconto (0-100):',
      initial: rule.discountPct.toString(),
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0 || n > 100)
          return 'O desconto deve ser entre 0 e 100%';
        return true;
      },
    });
    input.discountPct = parseInt(await discInput.run(), 10);
  }

  repo.save(input);
  console.log('\x1b[32mRegra atualizada com sucesso!\x1b[0m');
}
