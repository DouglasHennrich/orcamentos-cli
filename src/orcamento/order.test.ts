import { describe, it, expect } from 'vitest';
import { parseOrder, parseQuantity } from '../../src/orcamento/order.js';

describe('parseQuantity', () => {
  it('parses units', () => {
    expect(parseQuantity('2 UN')).toEqual({ value: 2, unit: 'UN' });
  });
  it('defaults to CX when no unit given', () => {
    expect(parseQuantity('4')).toEqual({ value: 4, unit: 'CX' });
  });
  it('parses explicit CX', () => {
    expect(parseQuantity('3 CX')).toEqual({ value: 3, unit: 'CX' });
  });
  it('is case/space insensitive', () => {
    expect(parseQuantity(' 5  un ')).toEqual({ value: 5, unit: 'UN' });
  });
  it('returns undefined for empty', () => {
    expect(parseQuantity(undefined)).toBeUndefined();
    expect(parseQuantity('')).toBeUndefined();
  });
});

describe('parseOrder', () => {
  it('parses a valid order', () => {
    const order = parseOrder({
      client: '028766370',
      produtos: [
        { name: 'Produto A', quantity: '2 UN' },
        { name: 'Produto B', quantity: '4' },
        { name: 'Produto C' },
      ],
    });
    expect(order.client).toBe('028766370');
    expect(order.produtos[0]).toEqual({ name: 'Produto A', quantity: { value: 2, unit: 'UN' } });
    expect(order.produtos[1]).toEqual({ name: 'Produto B', quantity: { value: 4, unit: 'CX' } });
    expect(order.produtos[2]).toEqual({ name: 'Produto C', quantity: undefined });
  });
  it('throws on missing client', () => {
    expect(() => parseOrder({ produtos: [] })).toThrow();
  });
  it('throws on invalid quantity', () => {
    expect(() => parseOrder({ client: 'x', produtos: [{ name: 'A', quantity: 'abc' }] })).toThrow();
  });
});
