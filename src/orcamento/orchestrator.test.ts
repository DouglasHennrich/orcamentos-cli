// src/orcamento/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOrcamento } from './orchestrator.js';
import { autoamerica } from '../platforms/autoamerica.js';
import type { Prompter } from '../io/prompt.js';
import type { IPortalDriver, DriverResult } from '../platforms/types.js';
import type { AliasRepository } from '../db/alias-repository.js';

/** Stub driver: total is computed from boxes * pricePerBox map (6 units/box). */
function priceModelDriver(pricePerBox: Record<string, number>) {
  const units: Record<string, number> = {};
  const ok = (data?: unknown): DriverResult<unknown> => ({ status: 'success', summary: '', data });

  return {
    login: vi.fn(async () => ok()),
    startQuote: vi.fn(async () => ok()),
    searchProducts: vi.fn(),
    addLine: vi.fn(async (code: string, u: number) => { units[code] = u; return ok(); }),
    updateLine: vi.fn(async (code: string, u: number) => { units[code] = u; return ok(); }),
    readLinePrice: vi.fn(async () => ok({ unit: 0, total: 0 })),
    applyDiscount: vi.fn(async () => ok()),
    readOrderTotal: vi.fn(async () => {
      const total = Object.entries(units).reduce(
        (sum, [code, u]) => sum + (u / 6) * (pricePerBox[code] ?? 0), 0,
      );
      return ok(total);
    }),
    setParcelas: vi.fn(async () => ok()),
    save: vi.fn(async () => ok()),
    exportQuote: vi.fn(async () => ok({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'CLIENTE STUB',
    })),
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
    save: vi.fn(),
    close: vi.fn(),
  } as unknown as AliasRepository;
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
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn(), askInts: vi.fn() };
    const result = await runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter: stubExportWriter(),
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
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn(), askInts };
    await runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter: stubExportWriter(),
    });
    // Should end up with 3 boxes = 18 units (1 initial + 2 bumps via updateLine)
    expect(driver._units.A).toBe(18);
    expect(askInts).toHaveBeenCalledTimes(2); // asked twice to bump from 1->2->3
  });

  it('applies 15% line discount when a line exceeds 10 boxes (Auto America)', async () => {
    const driver = priceModelDriver({ A: 300 }); // 11 boxes * 300 = 3300 >= 2500
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn(), askInts: vi.fn() };
    await runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 11)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter: stubExportWriter(),
    });
    expect(driver.applyDiscount).toHaveBeenCalledWith('A', 15);
  });

  it('exports the quote after saving and returns the written path', async () => {
    const driver = priceModelDriver({ A: 3000 });
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn(), askInts: vi.fn() };
    const exportWriter = vi.fn(async () => '/out/autoamerica/CLIENTE STUB.pdf');
    const result = await runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter,
    });
    expect(driver.exportQuote).toHaveBeenCalled();
    expect(exportWriter).toHaveBeenCalledWith({
      platform: 'autoamerica',
      clientName: 'CLIENTE STUB',
      pdfBase64: 'JVBERi0=',
    });
    expect(result.exportPath).toBe('/out/autoamerica/CLIENTE STUB.pdf');
  });

  it('throws when the mandatory export fails', async () => {
    const driver = priceModelDriver({ A: 3000 });
    driver.exportQuote = vi.fn(async () => ({ status: 'error' as const, summary: 'listagem vazia' }));
    const prompter: Prompter = { ask: vi.fn(), choose: vi.fn(), askInt: vi.fn(), askInts: vi.fn() };
    await expect(runOrcamento({
      platform: autoamerica, client: 'c', orderLines: [orderLine('A', 1)],
      driver: driver as unknown as IPortalDriver, prompter, repo: stubRepo(), exportWriter: stubExportWriter(),
    })).rejects.toThrow(/export obrigat/i);
  });
});
