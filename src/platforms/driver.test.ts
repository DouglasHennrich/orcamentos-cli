import { describe, it, expect } from 'vitest';
import { parseDropdownOptions, parseBRL, exportLastQuote } from './driver-helpers.js';

describe('parseBRL', () => {
  it('parses Brazilian currency', () => {
    expect(parseBRL('R$ 2.500,00')).toBe(2500);
    expect(parseBRL('1.234,56')).toBeCloseTo(1234.56);
    expect(parseBRL('R$ 0,00')).toBe(0);
  });
});

describe('exportLastQuote', () => {
  it('parses the export payload returned by the page', async () => {
    const payload = JSON.stringify({
      rec: '2050753',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
      filename: 'orcamento_2050753.pdf',
      pdfBase64: 'JVBERi0=',
    });
    const evalRaw = async () => payload;
    const result = await exportLastQuote(evalRaw);
    expect(result).toEqual({
      pdfBase64: 'JVBERi0=',
      orcamentoNumber: '098171',
      clientName: 'ZIKALIMP PRODUTOS DE LIMPEZA LTDA',
    });
  });

  it('throws when the page reports an error', async () => {
    const evalRaw = async () => JSON.stringify({ error: 'listagem vazia' });
    await expect(exportLastQuote(evalRaw)).rejects.toThrow(/listagem vazia/);
  });

  it('throws when the PDF is empty', async () => {
    const evalRaw = async () =>
      JSON.stringify({ orcamentoNumber: '1', clientName: 'X', pdfBase64: '' });
    await expect(exportLastQuote(evalRaw)).rejects.toThrow(/PDF vazio/);
  });
});

describe('parseDropdownOptions', () => {
  it('extracts code + name from "CODE - NAME" option labels', () => {
    const opts = parseDropdownOptions([
      '303535001 - BRILHO RAP S/SIL MOTHERS 473ML',
      '303535004 - CAL.GOLD SYNTHETIC WAX',
    ]);
    expect(opts).toEqual([
      { code: '303535001', name: 'BRILHO RAP S/SIL MOTHERS 473ML' },
      { code: '303535004', name: 'CAL.GOLD SYNTHETIC WAX' },
    ]);
  });
  it('keeps the raw label as name when there is no " - " separator', () => {
    expect(parseDropdownOptions(['MISC ITEM'])).toEqual([{ code: '', name: 'MISC ITEM' }]);
  });
});
