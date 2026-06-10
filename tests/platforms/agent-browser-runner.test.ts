import { describe, it, expect } from 'vitest';
import {
  makePrefixedRunner,
  makeRunner,
} from '../../src/platforms/agent-browser-runner.js';

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

describe('agent-browser runner wrappers', () => {
  it('prepends --headless for the headless runner', async () => {
    const runner = makePrefixedRunner(['--headless'], async (args) => ({
      stdout: args.join(' '),
      stderr: '',
      code: 0,
    }));
    const res = await runner(['snapshot', '-i']);
    expect(res.stdout).toBe('--headless snapshot -i');
  });

  it('prepends --headed for the headed runner', async () => {
    const runner = makePrefixedRunner(['--headed'], async (args) => ({
      stdout: args.join(' '),
      stderr: '',
      code: 0,
    }));
    const res = await runner(['snapshot', '-i']);
    expect(res.stdout).toBe('--headed snapshot -i');
  });
});
