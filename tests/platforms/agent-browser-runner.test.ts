import { describe, it, expect } from 'vitest';
import {
  makePrefixedRunner,
  makeRunner,
  ROBERLO_ARGS,
  ROBERLO_HEADED_ARGS,
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
  it('ROBERLO_ARGS contains the correct Chromium flag sequence', () => {
    expect(ROBERLO_ARGS).toEqual(['--args', '--disable-features=HttpsUpgrades']);
  });

  it('ROBERLO_HEADED_ARGS contains --headed and the correct Chromium flag sequence', () => {
    expect(ROBERLO_HEADED_ARGS).toEqual([
      '--headed',
      '--args',
      '--disable-features=HttpsUpgrades',
    ]);
  });

  it('roberloRunner prepends ROBERLO_ARGS before command args', async () => {
    const runner = makePrefixedRunner([...ROBERLO_ARGS], async (args) => ({
      stdout: args.join(' '),
      stderr: '',
      code: 0,
    }));
    const res = await runner(['navigate', 'http://example.com']);
    expect(res.stdout).toBe('--args --disable-features=HttpsUpgrades navigate http://example.com');
  });

  it('roberloHeadedRunner prepends ROBERLO_HEADED_ARGS before command args', async () => {
    const runner = makePrefixedRunner([...ROBERLO_HEADED_ARGS], async (args) => ({
      stdout: args.join(' '),
      stderr: '',
      code: 0,
    }));
    const res = await runner(['navigate', 'http://example.com']);
    expect(res.stdout).toBe('--headed --args --disable-features=HttpsUpgrades navigate http://example.com');
  });
});
