import { describe, it, expect } from 'vitest';
import { roberlo } from './roberlo.js';

describe('roberlo config', () => {
  it('has the right constraints', () => {
    expect(roberlo.minOrderValue).toBe(5000);
    expect(roberlo.frete).toBe('CIF');
    expect(roberlo.tipoOrcamento).toBe('Previsto');
    expect(roberlo.transportadora).toContain('TRANS');
  });
  it('discount is portal-driven (config returns 0)', () => {
    expect(roberlo.computeLineDiscount(99)).toBe(0);
  });
  it('parcelas: below 10k => 30/60/90', () => {
    expect(roberlo.computeParcelas(9999).label).toBe('30/60/90');
  });
});
