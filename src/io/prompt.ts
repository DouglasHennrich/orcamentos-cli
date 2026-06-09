import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import type { ProductOption } from '../platforms/types.js';

export interface Prompter {
  /** Free-text question; returns the trimmed answer. */
  ask(question: string): Promise<string>;
  /** Pick one option from a list, or return null to re-search. */
  choose(question: string, options: ProductOption[]): Promise<ProductOption | null>;
  /** Ask for a positive integer (e.g. units per box). */
  askInt(question: string): Promise<number>;
  /** Ask for one or more positive integers separated by commas. */
  askInts(question: string): Promise<number[]>;
}

export function formatOptions(options: ProductOption[]): string {
  return options.map((o, i) => `${i + 1}) ${o.code} - ${o.name}`).join('\n');
}

export class ConsolePrompter implements Prompter {
  // Lines buffered from stdin as they arrive. When stdin is a pipe, all data
  // arrives (and EOF fires) before any async portal work completes, so we must
  // buffer eagerly and serve from the buffer when `ask()` is finally called.
  private readonly lineBuffer: string[] = [];
  private readonly pending: Array<(line: string) => void> = [];
  private eof = false;
  private readonly rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input, output });
    this.rl.on('line', (line) => {
      const resolve = this.pending.shift();
      if (resolve) resolve(line.trimEnd());
      else this.lineBuffer.push(line.trimEnd());
    });
    this.rl.on('close', () => {
      this.eof = true;
      while (this.pending.length > 0) this.pending.shift()!('');
    });
  }

  close(): void {
    this.rl.close();
  }

  private readLine(): Promise<string> {
    if (this.lineBuffer.length > 0) return Promise.resolve(this.lineBuffer.shift()!);
    if (this.eof) return Promise.resolve('');
    return new Promise(resolve => this.pending.push(resolve));
  }

  async ask(question: string): Promise<string> {
    output.write(`${question} `);
    return this.readLine();
  }

  async askInt(question: string): Promise<number> {
    for (;;) {
      const raw = await this.ask(question);
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) return n;
      output.write('Digite um número inteiro positivo.\n');
    }
  }

  async askInts(question: string): Promise<number[]> {
    for (;;) {
      const raw = await this.ask(question);
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      const nums = parts.map(Number);
      if (parts.length > 0 && nums.every(n => Number.isInteger(n) && n > 0)) return nums;
      output.write('Digite um ou mais números inteiros positivos separados por vírgula.\n');
    }
  }

  async choose(question: string, options: ProductOption[]): Promise<ProductOption | null> {
    output.write(`${question}\n${formatOptions(options)}\n`);
    for (;;) {
      const raw = await this.ask('Escolha o número:');
      const n = Number(raw);
      if (n === 0) return null;
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        const chosen = options[n - 1];
        if (chosen) return chosen;
      }
      output.write('Opção inválida.\n');
    }
  }
}
