import { describe, it, expect } from 'vitest';
import { toSiteUnits } from './quantity.js';

describe('toSiteUnits', () => {
  const upb = 6; // units per box
  it('CX multiplies by units_per_box', () => {
    expect(toSiteUnits({ value: 4, unit: 'CX' }, upb)).toBe(24);
  });
  it('UN passes through unchanged', () => {
    expect(toSiteUnits({ value: 2, unit: 'UN' }, upb)).toBe(2);
  });
  it('not informed => one box', () => {
    expect(toSiteUnits(undefined, upb)).toBe(6);
  });
});
