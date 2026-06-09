// src/orcamento/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOrcamento } from '../../src/orcamento/orchestrator.js';
import { autoamerica } from '../../src/platforms/autoamerica.js';
import type { Prompter } from '../../src/io/prompt.js';
import type { IPortalDriver, DriverResult } from '../../src/platforms/types.js';
import type { AliasRepository } from '../../src/db/alias-repository.js';
import type { ProductRuleRepository } from '../../src/db/product-rule-repository.js';

/** Stub driver: total is computed from boxes * pricePerBox map (6 units/box). */
function priceModelDriver(pricePerBox: Record<string, number>) {
  const units: Record<string, number> = {};
  const ok = (data?: unknown): DriverResult<unknown> => ({
    status: 'success',
    summary: '',
    data,
  });

  return {
    login: vi.fn(async () => ok()),
    startQuote: vi.fn(async () => ok()),
    searchProducts: vi.fn(),
    addLine: vi.fn(async (code: string, u: number) => {
      units[code] = u;
      return ok();
    }),
    updateLine: vi.fn(async (code: string, u: number) => {
      units[code] = u;
      return ok();
    }),
    readLinePrice: vi.fn(async () => ok({ unit: 0, total: 0 })),
    applyDiscount: vi.fn(async () => ok()),
    readOrderTotal: vi.fn(async () => {
      const total = Object.entries(units).reduce(
        (sum, [code, u]) => sum + (u / 6) * (pricePerBox[code] ?? 0),
        0,
      );
      return ok(total);
    }),
    setParcelas: vi.fn(async () => ok()),
    save: vi.fn(async () => ok()),
    exportQuote: vi.fn(async () =>
      ok({
        pdfBase64: 'JVBERi0=',
        orcamentoNumber: '098171',
        clientName: 'CLIENTE STUB',
      }),
    ),
    _units: units,
  };
}

// Returns a mock repo whose find() always resolves a product by name (code === name, unitsPerBox=6).
function stubRepo(): AliasRepository {
  return {
    find: vi.fn((_platform, name: string) => ({
      platform: 'autoamerica' as const,
      aliasNorm: name.toLowerCase(),
      aliasRaw: name,
      productCode: name,
      productName: name,
      unitsPerBox: 6,
      createdAt: '',
    })),
    findFuzzy: vi.fn(() => undefined),
    save: vi.fn(),
    close: vi.fn(),
  } as unknown as AliasRepository;
}

function stubRuleRepo(rules: any[] = []): ProductRuleRepository {
  return {
    listByProvider: vi.fn(() => rules),
    save: vi.fn(),
    delete: vi.fn(),
    setEnabled: vi.fn(),
    close: vi.fn(),
  } as unknown as ProductRuleRepository;
}

// Helper: an order line where quantity is expressed in boxes.
const orderLine = (code: string, boxes: number) => ({
  name: code,
  quantity: { value: boxes, unit: 'CX' as const },
});

const stubExportWriter = () => vi.fn(async () => '/tmp/orc/CLIENTE STUB.pdf');

describe('runOrcamento', () => {
  it('stops at minimum when total already meets it; sets correct parcelas; saves', async () => {
    const driver = priceModelDriver({ A: 3000 }); // 1 box = 3000 >= 2500
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    const result = await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter: stubExportWriter(),
    });
    expect(driver.save).toHaveBeenCalled();
    expect(driver.setParcelas).toHaveBeenCalledWith({ label: '30/60' }); // 3000 < 5000
    expect(result.total).toBe(3000);
    expect(driver.applyDiscount).not.toHaveBeenCalled(); // 1 box, no discount
  });

  it('bumps 1 box at a time when below minimum, asking the user each step', async () => {
    // Each box = 1000; start with 1 box = 1000; need >= 2500 -> 3 boxes
    const driver = priceModelDriver({ A: 1000 });
    const askInts = vi.fn(async () => [1]); // user always picks line #1
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts,
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter: stubExportWriter(),
    });
    // Should end up with 3 boxes = 18 units (1 initial + 2 bumps via updateLine)
    expect(driver._units.A).toBe(18);
    expect(askInts).toHaveBeenCalledTimes(2); // asked twice to bump from 1->2->3
  });

  it('applies 15% line discount when a line exceeds 10 boxes (Auto America)', async () => {
    const driver = priceModelDriver({ A: 300 }); // 11 boxes * 300 = 3300 >= 2500
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 11)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter: stubExportWriter(),
    });
    expect(driver.applyDiscount).toHaveBeenCalledWith('A', 15);
  });

  it('exports the quote after saving and returns the written path', async () => {
    const driver = priceModelDriver({ A: 3000 });
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    const exportWriter = vi.fn(async () => '/out/autoamerica/CLIENTE STUB.pdf');
    const result = await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter,
    });
    expect(driver.exportQuote).toHaveBeenCalled();
    expect(exportWriter).toHaveBeenCalledWith({
      platform: 'autoamerica',
      clientName: 'CLIENTE STUB',
      pdfBase64: 'JVBERi0=',
    });
    expect(result.exportPath).toBe('/out/autoamerica/CLIENTE STUB.pdf');
  });

  it('does not save or export when running in dry-run mode', async () => {
    const driver = priceModelDriver({ A: 3000 });
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    const exportWriter = vi.fn(async () => '/out/autoamerica/CLIENTE STUB.pdf');
    const result = await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter,
      dryRun: true,
    });
    expect(driver.save).not.toHaveBeenCalled();
    expect(driver.exportQuote).not.toHaveBeenCalled();
    expect(exportWriter).not.toHaveBeenCalled();
    expect(result.total).toBe(3000);
    expect(result.exportPath).toBe('(simulação)');
  });

  it('captures a final screenshot when screenshotPath is provided', async () => {
    const driver = priceModelDriver({ A: 3000 }) as unknown as IPortalDriver;
    const screenshot = vi.fn(async () => ({ status: 'success' as const, summary: 'ok' }));
    (driver as any).captureScreenshot = screenshot;

    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    const exportWriter = vi.fn(async () => '/out/autoamerica/CLIENTE STUB.pdf');
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter,
      screenshotPath: '/tmp/final-pedido.png',
    });

    expect(screenshot).toHaveBeenCalledWith('/tmp/final-pedido.png');
  });

  it('throws when the mandatory export fails', async () => {
    const driver = priceModelDriver({ A: 3000 });
    driver.exportQuote = vi.fn(async () => ({
      status: 'error' as const,
      summary: 'listagem vazia',
    }));
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await expect(
      runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 1)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo: stubRuleRepo(),
        exportWriter: stubExportWriter(),
      }),
    ).rejects.toThrow(/export obrigat/i);
  });

  it('injects add-product rule when product is missing', async () => {
    const driver = priceModelDriver({ A: 1000, B: 2000 });
    const ruleRepo = stubRuleRepo([
      {
        type: 'add-product',
        productCode: 'B',
        quantityValue: 1,
        quantityUnit: 'CX',
        enabled: true,
        unitsPerBox: 6,
      },
    ]);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo,
      exportWriter: stubExportWriter(),
    });
    expect(driver.addLine).toHaveBeenCalledWith('A', 6);
    expect(driver.addLine).toHaveBeenCalledWith('B', 6);
  });

  it('sums add-product rule with existing line', async () => {
    const driver = priceModelDriver({ A: 1000 });
    const ruleRepo = stubRuleRepo([
      {
        type: 'add-product',
        productCode: 'A',
        quantityValue: 2,
        quantityUnit: 'CX',
        enabled: true,
        unitsPerBox: 6,
      },
    ]);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo,
      exportWriter: stubExportWriter(),
    });
    // 1 user box + 2 rule boxes = 3 boxes = 18 units
    expect(driver.addLine).toHaveBeenCalledWith('A', 18);
  });

  it('applies override-discount rule instead of automatic logic', async () => {
    const driver = priceModelDriver({ A: 300 }); // 11 boxes * 300 = 3300 -> 15% auto
    const ruleRepo = stubRuleRepo([
      {
        type: 'override-discount',
        productCode: 'A',
        discountPct: 5,
        enabled: true,
      },
    ]);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 11)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo,
      exportWriter: stubExportWriter(),
    });
    expect(driver.applyDiscount).toHaveBeenCalledWith('A', 5);
    expect(driver.applyDiscount).not.toHaveBeenCalledWith('A', 15);
  });

  it('throws in non-interactive mode when below minimum', async () => {
    const driver = priceModelDriver({ A: 1000 }); // 1000 < 2500
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await expect(
      runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 1)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo: stubRuleRepo(),
        exportWriter: stubExportWriter(),
        interactive: false,
      }),
    ).rejects.toThrow(/requer intervenção manual/i);
  });

  it('continues processing other products when addLine fails for one', async () => {
    const driver = priceModelDriver({ A: 3000, B: 3000 });
    driver.addLine = vi.fn(async (code: string) => {
      if (code === 'A')
        return { status: 'error' as const, summary: 'Falha produto A' };
      driver._units[code] = 6;
      return { status: 'success' as const, summary: '' };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await runOrcamento({
      platform: autoamerica,
      client: 'c',
      orderLines: [orderLine('A', 1), orderLine('B', 1)],
      driver: driver as unknown as IPortalDriver,
      prompter,
      repo: stubRepo(),
      ruleRepo: stubRuleRepo(),
      exportWriter: stubExportWriter(),
    });
    expect(driver.addLine).toHaveBeenCalledWith('A', 6);
    expect(driver.addLine).toHaveBeenCalledWith('B', 6);
    // B should still have discount logic applied; A should not (not in boxes map)
    expect(driver.applyDiscount).not.toHaveBeenCalledWith(
      'A',
      expect.anything(),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 produto'));
    warnSpy.mockRestore();
  });

  it('throws in non-interactive mode when alias missing', async () => {
    const driver = priceModelDriver({});
    const repo = stubRepo();
    repo.find = vi.fn(() => undefined);
    const prompter: Prompter = {
      ask: vi.fn(),
      choose: vi.fn(),
      askInt: vi.fn(),
      askInts: vi.fn(),
    };
    await expect(
      runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 1)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo,
        ruleRepo: stubRuleRepo(),
        exportWriter: stubExportWriter(),
        interactive: false,
      }),
    ).rejects.toThrow(/modo não-interativo/i);
  });

  describe('threshold-discount rules', () => {
    it('applies threshold discount when box count meets minimum', async () => {
      const driver = priceModelDriver({ A: 3000 });
      const ruleRepo = stubRuleRepo([
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 10,
          discountPct: 15,
          enabled: true,
        },
      ]);
      const prompter: Prompter = {
        ask: vi.fn(),
        choose: vi.fn(),
        askInt: vi.fn(),
        askInts: vi.fn(),
      };
      await runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 10)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo,
        exportWriter: stubExportWriter(),
      });
      expect(driver.applyDiscount).toHaveBeenCalledWith('A', 15);
    });

    it('falls through to platform auto-discount when below threshold', async () => {
      const driver = priceModelDriver({ A: 3000 });
      const ruleRepo = stubRuleRepo([
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 10,
          discountPct: 15,
          enabled: true,
        },
      ]);
      const prompter: Prompter = {
        ask: vi.fn(),
        choose: vi.fn(),
        askInt: vi.fn(),
        askInts: vi.fn(),
      };
      await runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 9)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo,
        exportWriter: stubExportWriter(),
      });
      // Autoamerica auto-discount for 9 boxes is actually 0% in this mock config
      // (only > 10 boxes get 15%).
      expect(driver.applyDiscount).not.toHaveBeenCalled();
    });

    it('picks the highest matching tier when multiple tiers apply', async () => {
      const driver = priceModelDriver({ A: 3000 });
      const ruleRepo = stubRuleRepo([
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 5,
          discountPct: 10,
          enabled: true,
        },
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 10,
          discountPct: 20,
          enabled: true,
        },
      ]);
      const prompter: Prompter = {
        ask: vi.fn(),
        choose: vi.fn(),
        askInt: vi.fn(),
        askInts: vi.fn(),
      };
      await runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 12)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo,
        exportWriter: stubExportWriter(),
      });
      expect(driver.applyDiscount).toHaveBeenCalledWith('A', 20);
    });

    it('picks the lower matching tier when between tiers', async () => {
      const driver = priceModelDriver({ A: 3000 });
      const ruleRepo = stubRuleRepo([
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 5,
          discountPct: 10,
          enabled: true,
        },
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 10,
          discountPct: 20,
          enabled: true,
        },
      ]);
      const prompter: Prompter = {
        ask: vi.fn(),
        choose: vi.fn(),
        askInt: vi.fn(),
        askInts: vi.fn(),
      };
      await runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 7)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo,
        exportWriter: stubExportWriter(),
      });
      expect(driver.applyDiscount).toHaveBeenCalledWith('A', 10);
      expect(driver.applyDiscount).not.toHaveBeenCalledWith('A', 20);
    });

    it('gives priority to override-discount over matching threshold', async () => {
      const driver = priceModelDriver({ A: 3000 });
      const ruleRepo = stubRuleRepo([
        {
          type: 'threshold-discount',
          productCode: '*',
          quantityValue: 10,
          discountPct: 20,
          enabled: true,
        },
        {
          type: 'override-discount',
          productCode: 'A',
          discountPct: 5,
          enabled: true,
        },
      ]);
      const prompter: Prompter = {
        ask: vi.fn(),
        choose: vi.fn(),
        askInt: vi.fn(),
        askInts: vi.fn(),
      };
      await runOrcamento({
        platform: autoamerica,
        client: 'c',
        orderLines: [orderLine('A', 15)],
        driver: driver as unknown as IPortalDriver,
        prompter,
        repo: stubRepo(),
        ruleRepo,
        exportWriter: stubExportWriter(),
      });
      expect(driver.applyDiscount).toHaveBeenCalledWith('A', 5);
      expect(driver.applyDiscount).not.toHaveBeenCalledWith('A', 20);
    });
  });
});
