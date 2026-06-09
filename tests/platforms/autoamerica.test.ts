import { describe, it, expect } from 'vitest';
import { autoamerica } from '../../src/platforms/autoamerica.js';

describe('autoamerica config', () => {
  it('has the right constraints', () => {
    expect(autoamerica.minOrderValue).toBe(2500);
    expect(autoamerica.tabelaPrecos).toBe('099 - POLIMENTO C5_12% SP-RS-MG-RJ');
    expect(autoamerica.frete).toBe('CIF');
    expect(autoamerica.tipoOrcamento).toBe('Em elaboração');
  });
  it('gives 15% discount for more than 10 boxes', () => {
    expect(autoamerica.computeLineDiscount(11)).toBe(15);
    expect(autoamerica.computeLineDiscount(10)).toBe(0);
    expect(autoamerica.computeLineDiscount(1)).toBe(0);
  });
  it('parcelas: below 5k => 30/60, below 10k => 30/60/90', () => {
    expect(autoamerica.computeParcelas(4999).label).toBe('30/60');
    expect(autoamerica.computeParcelas(5000).label).toBe('30/60/90');
    expect(autoamerica.computeParcelas(9999).label).toBe('30/60/90');
  });
});
