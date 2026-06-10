import { describe, it, expect, vi } from 'vitest';
import { ConsolePrompter, formatOptions } from '../../src/io/prompt.js';
import type { Prompter } from '../../src/io/prompt.js';
import type { ProductOption } from '../../src/platforms/types.js';

describe('ConsolePrompter', () => {
  function installReadLines(
    prompter: ConsolePrompter,
    values: Array<string | (() => Promise<string>)>,
  ) {
    let index = 0;
    const readLine = vi.fn(async () => {
      const next = values[index++];
      return typeof next === 'function' ? await next() : next;
    });
    (prompter as unknown as { readLine: typeof readLine }).readLine = readLine;
    return readLine;
  }

  it('serializes two concurrent ask() calls in FIFO order', async () => {
    const output = { write: vi.fn() } as any;
    const prompter = new ConsolePrompter({ output });
    installReadLines(prompter, [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'first';
      },
      'second',
    ]);

    const first = prompter.ask('Pergunta 1?');
    const second = prompter.ask('Pergunta 2?');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((prompter as any).readLine).toHaveBeenCalledTimes(1);

    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(output.write).toHaveBeenNthCalledWith(1, 'Pergunta 1? ');
    expect(output.write).toHaveBeenNthCalledWith(2, 'Pergunta 2? ');
  });

  it('holds the mutex through askInt invalid re-prompt until a valid value is provided', async () => {
    const output = { write: vi.fn() } as any;
    const prompter = new ConsolePrompter({ output });

    // We want askInt to:
    // 1. call readLine -> get 'invalid'
    // 2. call readLine -> get '2' (delayed)
    // During this time, the mutex should be held.
    let resolveSecondCall!: (val: string) => void;
    const secondCallPromise = new Promise<string>((resolve) => {
      resolveSecondCall = resolve;
    });

    installReadLines(prompter, ['invalid', () => secondCallPromise, 'ok']);

    const askIntPromise = prompter.askInt('Digite um número:');

    // Give it time to call readLine twice (once resolved instantly, second pending)
    await new Promise((resolve) => setTimeout(resolve, 30));

    const askPromise = prompter.ask('Outra pergunta?');

    // Wait more - askPromise should still be pending because askInt is pending on second call
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect((prompter as any).readLine).toHaveBeenCalledTimes(2);

    // Now resolve the second call of askInt
    resolveSecondCall('2');
    expect(await askIntPromise).toBe(2);

    // Now askPromise should be able to run
    expect(await askPromise).toBe('ok');
    expect((prompter as any).readLine).toHaveBeenCalledTimes(3);
  });

  it('prepends context prefix to questions using withContext()', async () => {
    const output = { write: vi.fn() } as any;
    const prompter = new ConsolePrompter({ output });
    installReadLines(prompter, ['resposta']);

    const contextual = prompter.withContext('[CTX]');
    const answer = await contextual.ask('Qual é o valor?');

    expect(answer).toBe('resposta');
    expect(output.write).toHaveBeenCalledWith('[CTX] Qual é o valor? ');
  });

  it('shares the same mutex across multiple contexts created with withContext()', async () => {
    const output = { write: vi.fn() } as any;
    const prompter = new ConsolePrompter({ output });
    installReadLines(prompter, [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'primeiro';
      },
      'segundo',
    ]);

    const first = prompter.withContext('[A]').ask('P1?');
    const second = prompter.withContext('[B]').ask('P2?');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((prompter as any).readLine).toHaveBeenCalledTimes(1);

    expect(await first).toBe('primeiro');
    expect(await second).toBe('segundo');
    expect(output.write).toHaveBeenNthCalledWith(1, '[A] P1? ');
    expect(output.write).toHaveBeenNthCalledWith(2, '[B] P2? ');
  });

  it('preserves single-request behavior for ask()', async () => {
    const output = { write: vi.fn() } as any;
    const prompter = new ConsolePrompter({ output });
    installReadLines(prompter, ['uma resposta']);

    const answer = await prompter.ask('Uma pergunta simples?');

    expect(answer).toBe('uma resposta');
    expect(output.write).toHaveBeenCalledWith('Uma pergunta simples? ');
  });
});

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
