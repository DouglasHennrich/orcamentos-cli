import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import { runBatch } from '../../src/orcamento/batch-runner.js';
import type { IPortalDriver } from '../../src/platforms/types.js';
import type { Prompter } from '../../src/io/prompt.js';

vi.mock('node:fs/promises');
vi.mock('../../src/orcamento/orchestrator.js', () => ({
  runOrcamento: vi.fn(async ({ client }) => ({
    total: client === 'fail' ? 0 : 100,
    parcelas: '1x',
    exportPath: 'out.pdf',
  })),
}));

// Set dummy env for tests
process.env.AUTOAMERICA_USER = 'test';
process.env.AUTOAMERICA_PASS = 'test';
process.env.ROBERLO_USER = 'test';
process.env.ROBERLO_PASS = 'test';

describe('runBatch', () => {
  const options = {
    platform: {} as any,
    driverFactory: () => ({}) as IPortalDriver,
    prompter: {
      withContext: vi.fn().mockReturnThis(),
    } as unknown as Prompter,
    repo: {} as any,
    clientRepo: {} as any,
    ruleRepo: {} as any,
    exportWriter: {} as any,
    concurrency: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully processes multiple files', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ provider: 'autoamerica', client: 'cli1', produtos: [] }),
    );
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ provider: 'roberlo', client: 'cli2', produtos: [] }),
    );

    const summary = await runBatch(['f1.json', 'f2.json'], options);

    expect(summary.totalSuccess).toBe(2);
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0]?.status).toBe('success');
  });

  it('collects errors for invalid files', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce('invalid json');

    const summary = await runBatch(['bad.json'], options);

    expect(summary.totalErrors).toBe(1);
    expect(summary.results[0]?.status).toBe('error');
  });

  it('collects errors for missing fields', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ client: 'cli' }),
    ); // missing provider

    const summary = await runBatch(['missing.json'], options);

    expect(summary.totalErrors).toBe(1);
    expect(summary.results[0]?.status).toBe('error');
    expect(summary.results[0]?.error).toContain('provider');
  });
});
