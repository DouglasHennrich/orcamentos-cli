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

describe('roberlo runners', () => {
  it('roberloRunner prepends --args and the HttpsUpgrades flag', async () => {
    const captured: string[][] = [];
    const fakeExec: import('../../src/platforms/agent-browser-runner.js').ExecFn =
      async (args) => {
        captured.push(args);
        return { stdout: args.join(' '), stderr: '', code: 0 };
      };
    const runner = makePrefixedRunner(
      ['--args', '--disable-features=HttpsUpgrades'],
      fakeExec,
    );
    await runner(['navigate', 'http://example.com']);
    expect(captured[0]).toEqual([
      '--args',
      '--disable-features=HttpsUpgrades',
      'navigate',
      'http://example.com',
    ]);
  });

  it('roberloHeadedRunner prepends --headed and the HttpsUpgrades flag', async () => {
    const captured: string[][] = [];
    const fakeExec: import('../../src/platforms/agent-browser-runner.js').ExecFn =
      async (args) => {
        captured.push(args);
        return { stdout: args.join(' '), stderr: '', code: 0 };
      };
    const runner = makePrefixedRunner(
      ['--headed', '--args', '--disable-features=HttpsUpgrades'],
      fakeExec,
    );
    await runner(['navigate', 'http://example.com']);
    expect(captured[0]).toEqual([
      '--headed',
      '--args',
      '--disable-features=HttpsUpgrades',
      'navigate',
      'http://example.com',
    ]);
  });
});
