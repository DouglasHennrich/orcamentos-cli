import { describe, it, expect } from 'vitest';
import { AutoAmericaDriver } from '../../src/platforms/autoamerica-driver.js';
import { RoberloDriver } from '../../src/platforms/roberlo-driver.js';
import type {
  AgentBrowserRunner,
  RunResult,
} from '../../src/platforms/agent-browser-runner.js';

// Reproduz a dupla serialização do agent-browser: a página retorna JSON.stringify(obj),
// e o agent-browser serializa essa string de novo como JSON.
function enc(obj: unknown): string {
  return JSON.stringify(JSON.stringify(obj));
}

function runnerReturning(payload: unknown): AgentBrowserRunner {
  return async (): Promise<RunResult> => ({
    stdout: enc(payload),
    stderr: '',
    code: 0,
  });
}

const okPayload = {
  rec: '2050753',
  orcamentoNumber: '098171',
  clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
  filename: 'orcamento_2050753.pdf',
  pdfBase64: 'JVBERi0=',
};

describe('AutoAmericaDriver.exportQuote', () => {
  it('returns success with the exported quote data', async () => {
    const driver = new AutoAmericaDriver(runnerReturning(okPayload), 'u', 'p');
    const res = await driver.exportQuote();
    expect(res.status).toBe('success');
    expect(res.data).toEqual({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
    });
  });

  it('returns error status when the page reports an error', async () => {
    const driver = new AutoAmericaDriver(
      runnerReturning({ error: 'listagem vazia' }),
      'u',
      'p',
    );
    const res = await driver.exportQuote();
    expect(res.status).toBe('error');
    expect(res.summary).toMatch(/listagem vazia/);
  });
});

describe('RoberloDriver.exportQuote', () => {
  it('returns success with the exported quote data', async () => {
    const driver = new RoberloDriver(runnerReturning(okPayload), 'u', 'p');
    const res = await driver.exportQuote();
    expect(res.status).toBe('success');
    expect(res.data).toEqual({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
    });
  });
});
