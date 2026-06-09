import { describe, it, expect } from 'vitest';
import { formatOptions } from '../../src/io/prompt.js';

describe('formatOptions', () => {
  it('numbers options from 1', () => {
    const text = formatOptions([
      { code: '1', name: 'Alpha' },
      { code: '2', name: 'Beta' },
    ]);
    expect(text).toContain('1) 1 - Alpha');
    expect(text).toContain('2) 2 - Beta');
  });
});
