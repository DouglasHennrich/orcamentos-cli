import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runRulesEditor } from '../../src/cli/rules-editor.js';
import type { AliasRepository } from '../../src/db/alias-repository.js';
import type { ProductRuleRepository } from '../../src/db/product-rule-repository.js';

const { promptAnswers, MockSelect, MockInput, MockConfirm } = vi.hoisted(() => {
  return {
    promptAnswers: [] as string[],
    MockSelect: vi.fn(function (this: any, options: any) {
      this.options = options;
      this.run = vi.fn(async () => promptAnswers.shift()!);
    }),
    MockInput: vi.fn(function (this: any, options: any) {
      this.options = options;
      this.run = vi.fn(async () => promptAnswers.shift()!);
    }),
    MockConfirm: vi.fn(function (this: any, options: any) {
      this.options = options;
      this.run = vi.fn(async () => promptAnswers.shift()!);
    }),
  };
});

vi.mock('enquirer', () => ({
  default: {
    Select: MockSelect,
    Input: MockInput,
    Confirm: MockConfirm,
  },
}));

function stubRuleRepo(): ProductRuleRepository {
  return {
    listByProvider: vi.fn(() => []),
    save: vi.fn(),
    delete: vi.fn(),
    setEnabled: vi.fn(),
    close: vi.fn(),
  } as unknown as ProductRuleRepository;
}

function stubAliasRepo(
  overrides: Partial<AliasRepository> = {},
): AliasRepository {
  return {
    find: vi.fn(),
    findFuzzy: vi.fn(),
    save: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as AliasRepository;
}

describe('runRulesEditor', () => {
  beforeEach(() => {
    promptAnswers.length = 0;
    MockSelect.mockClear();
    MockInput.mockClear();
    MockConfirm.mockClear();
    vi.clearAllMocks();
  });

  it('saves a global threshold-discount rule with productCode="*"', async () => {
    const ruleRepo = stubRuleRepo();
    const aliasRepo = stubAliasRepo();

    // 1. Choose provider: autoamerica
    // 2. Action: add
    // 3. Type: threshold-discount
    // 4. Scope: global
    // 5. Min boxes: 10
    // 6. Discount: 5
    // 7. Exit loop
    promptAnswers.push(
      'autoamerica',
      'add',
      'threshold-discount',
      'global',
      '10',
      '5',
      'exit',
    );

    await runRulesEditor(ruleRepo, aliasRepo);

    expect(ruleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'autoamerica',
        type: 'threshold-discount',
        productCode: '*',
        quantityValue: 10,
        discountPct: 5,
      }),
    );
  });

  it('saves a product-specific threshold-discount rule and creates an alias if needed', async () => {
    const ruleRepo = stubRuleRepo();
    const aliasRepo = stubAliasRepo();

    // 1. autoamerica
    // 2. add
    // 3. threshold-discount
    // 4. product (specific)
    // 5. Code: PROD1
    // 6. Name: Test Product
    // 7. Min boxes: 5
    // 8. Discount: 15
    // 9. exit
    promptAnswers.push(
      'autoamerica',
      'add',
      'threshold-discount',
      'product',
      'PROD1',
      'Test Product',
      '1', // unidades por caixa para o novo produto
      '5',
      '15',
      'exit',
    );

    await runRulesEditor(ruleRepo, aliasRepo);

    expect(aliasRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productCode: 'PROD1',
        aliases: ['PROD1'],
        productName: 'Test Product',
      }),
    );
    expect(ruleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productCode: 'PROD1',
        type: 'threshold-discount',
        quantityValue: 5,
        discountPct: 15,
      }),
    );
  });

  it('uses existing alias when creating a product-specific threshold rule', async () => {
    const ruleRepo = stubRuleRepo();
    const aliasRepo = stubAliasRepo({
      find: vi.fn(() => ({ productCode: 'REAL-CODE' }) as any),
    });

    promptAnswers.push(
      'autoamerica',
      'add',
      'threshold-discount',
      'product',
      'ALIAS1',
      'ignored',
      '1',
      '10',
      'exit',
    );

    await runRulesEditor(ruleRepo, aliasRepo);

    expect(aliasRepo.save).not.toHaveBeenCalled();
    expect(ruleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productCode: 'REAL-CODE',
      }),
    );
  });
});
