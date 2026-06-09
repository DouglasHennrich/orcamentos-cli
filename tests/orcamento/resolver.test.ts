import { describe, it, expect, vi } from 'vitest';
import { resolveLine } from '../../src/orcamento/resolver.js';
import type { Prompter } from '../../src/io/prompt.js';
import type {
  IPortalDriver,
  ProductOption,
} from '../../src/platforms/types.js';

function stubDriver(options: ProductOption[]): IPortalDriver {
  return {
    login: vi.fn(),
    startQuote: vi.fn(),
    addLine: vi.fn(),
    updateLine: vi.fn(),
    readLinePrice: vi.fn(),
    applyDiscount: vi.fn(),
    readOrderTotal: vi.fn(),
    setParcelas: vi.fn(),
    save: vi.fn(),
    searchProducts: vi.fn(async () => ({
      status: 'success' as const,
      summary: '',
      data: options,
    })),
    exportQuote: vi.fn(),
  };
}

describe('resolveLine', () => {
  it('uses the cache on a hit and converts CX to units', async () => {
    const repo = {
      find: vi.fn(() => ({
        productCode: '303535001',
        productName: 'BRILHO',
        unitsPerBox: 6,
        platform: 'autoamerica' as const,
        aliasNorm: 'produto a',
        aliasRaw: 'Produto A',
        createdAt: '',
      })),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const line = {
      name: 'Produto A',
      quantity: { value: 4, unit: 'CX' as const },
    };
    const resolved = await resolveLine(line, {
      platform: 'autoamerica',
      repo: repo as any,
      driver: stubDriver([]),
      prompter: { askInts: vi.fn() } as unknown as Prompter,
    });
    expect(resolved.productCode).toBe('303535001');
    expect(resolved.siteUnits).toBe(24); // 4 boxes * 6 units/box
    expect(resolved.boxes).toBe(4);
    expect(resolved.resolvedFrom).toBe('cache');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('on a miss, searches live, asks the user, persists, and converts', async () => {
    const repo = {
      find: vi.fn(() => undefined),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const options = [{ code: '303535001', name: 'BRILHO RAP' }];
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(async () => options[0] as ProductOption | null),
      askInt: vi.fn(async () => 6),
      askInts: vi.fn(),
    };
    const line = {
      name: 'Produto A',
      quantity: { value: 2, unit: 'UN' as const },
    };
    const resolved = await resolveLine(line, {
      platform: 'autoamerica',
      repo: repo as any,
      driver: stubDriver(options),
      prompter,
    });
    expect(prompter.choose).toHaveBeenCalled();
    expect(prompter.ask).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'autoamerica',
        aliases: ['Produto A'],
        productCode: '303535001',
        unitsPerBox: 6,
      }),
    );
    expect(resolved.resolvedFrom).toBe('interactive');
    expect(resolved.siteUnits).toBe(2); // UN passes through
    expect(resolved.boxes).toBe(1); // ceil(2/6) = 1
  });

  it('saves alias with only the original product name (no extra aliases)', async () => {
    const repo = {
      find: vi.fn(() => undefined),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const options = [{ code: '303535001', name: 'BRILHO RAP' }];
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(async () => options[0] as ProductOption | null),
      askInt: vi.fn(async () => 6),
      askInts: vi.fn(),
    };
    await resolveLine(
      { name: 'Produto A', quantity: undefined },
      {
        platform: 'autoamerica',
        repo: repo as any,
        driver: stubDriver(options),
        prompter,
      },
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        aliases: ['Produto A'],
      }),
    );
    expect(prompter.ask).not.toHaveBeenCalled();
  });

  it('uses readUnitsPerBox from driver when available, skips askInt', async () => {
    const repo = {
      find: vi.fn(() => undefined),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const options = [{ code: '303535001', name: 'BRILHO RAP' }];
    const driver = {
      ...stubDriver(options),
      readUnitsPerBox: vi.fn(async () => 12),
    };
    const askInt = vi.fn(async () => 6);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(async () => options[0] as ProductOption | null),
      askInt,
      askInts: vi.fn(),
    };
    const resolved = await resolveLine(
      { name: 'Produto A', quantity: { value: 2, unit: 'CX' as const } },
      {
        platform: 'autoamerica',
        repo: repo as any,
        driver: driver as any,
        prompter,
      },
    );
    expect(driver.readUnitsPerBox).toHaveBeenCalledWith('303535001');
    expect(askInt).not.toHaveBeenCalled();
    expect(resolved.unitsPerBox).toBe(12);
    expect(resolved.siteUnits).toBe(24); // 2 CX * 12 units/box
  });

  it('falls back to askInt when readUnitsPerBox returns undefined', async () => {
    const repo = {
      find: vi.fn(() => undefined),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const options = [{ code: '303535001', name: 'BRILHO RAP' }];
    const driver = {
      ...stubDriver(options),
      readUnitsPerBox: vi.fn(async () => undefined),
    };
    const askInt = vi.fn(async () => 8);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(async () => options[0] as ProductOption | null),
      askInt,
      askInts: vi.fn(),
    };
    await resolveLine(
      { name: 'Produto A', quantity: undefined },
      {
        platform: 'autoamerica',
        repo: repo as any,
        driver: driver as any,
        prompter,
      },
    );
    expect(askInt).toHaveBeenCalledWith(expect.stringContaining('BRILHO RAP'));
  });

  it('re-searches when the user picks null then chooses', async () => {
    const repo = {
      find: vi.fn(() => undefined),
      findFuzzy: vi.fn(() => undefined),
      save: vi.fn(),
    };
    const opts = [{ code: '1', name: 'A' }];
    const choose = vi
      .fn()
      .mockResolvedValueOnce(null) // first: none -> re-search
      .mockResolvedValueOnce(opts[0]!); // second: pick
    const ask = vi
      .fn()
      .mockResolvedValueOnce('a'); // re-search terms only (no extra aliases prompt)
    const prompter: Prompter = {
      ask,
      choose,
      askInt: vi.fn(async () => 3),
      askInts: vi.fn(),
    };
    const resolved = await resolveLine(
      { name: 'Z', quantity: undefined },
      {
        platform: 'roberlo',
        repo: repo as any,
        driver: stubDriver(opts),
        prompter,
      },
    );
    expect(choose).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledTimes(1); // only re-search terms, no extra aliases
    expect(resolved.siteUnits).toBe(3); // not informed -> one box (unitsPerBox=3)
  });
});
