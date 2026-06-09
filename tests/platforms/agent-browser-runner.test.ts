import { describe, it, expect } from 'vitest';
import { makeRunner } from '../../src/platforms/agent-browser-runner.js';

describe('makeRunner', () => {
  it('runs a command and captures stdout', async () => {
    const runner = makeRunner(async (args) => ({
      stdout: args.join(' '),
      stderr: '',
      code: 0,
    }));
    const res = await runner(['snapshot', '-i']);
    expect(res.stdout).toBe('snapshot -i');
    expect(res.code).toBe(0);
  });
});
