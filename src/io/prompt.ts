import * as readline from 'node:readline';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import type { ProductOption } from '../platforms/types.js';

interface ConsolePrompterOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export interface Prompter {
  /** Free-text question; returns the trimmed answer. */
  ask(question: string): Promise<string>;
  /** Pick one option from a list, or return null to re-search. */
  choose(
    question: string,
    options: ProductOption[],
  ): Promise<ProductOption | null>;
  /** Ask for a positive integer (e.g. units per box). */
  askInt(question: string): Promise<number>;
  /** Ask for one or more positive integers separated by commas. */
  askInts(question: string): Promise<number[]>;
  /** Return a new prompter that prepends a prefix to all questions. */
  withContext(prefix: string): Prompter;
}

export function formatOptions(options: ProductOption[]): string {
  return options.map((o, i) => `${i + 1}) ${o.code} - ${o.name}`).join('\n');
}

export class ConsolePrompter implements Prompter {
  // Lines buffered from stdin as they arrive. When stdin is a pipe, all data
  // arrives (and EOF fires) before any async portal work completes, so we must
  // buffer eagerly and serve from the buffer when `ask()` is finally called.
  private readonly lineBuffer: string[] = [];
  private readonly pending: Array<(line: string | null) => void> = [];
  private eof = false;
  private readonly rl: readline.Interface;
  private readonly output: NodeJS.WritableStream;
  private _lock: Promise<void> = Promise.resolve();

  constructor(options: ConsolePrompterOptions = {}) {
    const input = options.input ?? defaultInput;
    this.output = options.output ?? defaultOutput;
    this.rl = readline.createInterface({ input, output: this.output });
    this.rl.on('line', (line) => {
      const resolve = this.pending.shift();
      if (resolve) resolve(line.trimEnd());
      else this.lineBuffer.push(line.trimEnd());
    });
    this.rl.on('close', () => {
      this.eof = true;
      while (this.pending.length > 0) this.pending.shift()!(null);
    });
  }

  close(): void {
    this.rl.close();
  }

  private readLine(): Promise<string> {
    if (this.lineBuffer.length > 0)
      return Promise.resolve(this.lineBuffer.shift()!);
    if (this.eof) return Promise.reject(new Error('EOF: Input stream closed'));
    return new Promise((resolve, reject) => {
      this.pending.push((line) => {
        if (line === null) reject(new Error('EOF: Input stream closed'));
        else resolve(line);
      });
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const unlock = this._lock;
    let release!: () => void;
    this._lock = new Promise((resolve) => {
      release = resolve;
    });

    return unlock.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }

  private async askRaw(question: string): Promise<string> {
    this.output.write(`${question} `);
    return this.readLine();
  }

  async ask(question: string): Promise<string> {
    return this.enqueue(() => this.askRaw(question));
  }

  async askInt(question: string): Promise<number> {
    return this.enqueue(async () => {
      for (;;) {
        const raw = await this.askRaw(question);
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) return n;
        this.output.write('Digite um número inteiro positivo.\n');
      }
    });
  }

  async askInts(question: string): Promise<number[]> {
    return this.enqueue(async () => {
      for (;;) {
        const raw = await this.askRaw(question);
        const parts = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const nums = parts.map(Number);
        if (parts.length > 0 && nums.every((n) => Number.isInteger(n) && n > 0))
          return nums;
        this.output.write(
          'Digite um ou mais números inteiros positivos separados por vírgula.\n',
        );
      }
    });
  }

  async choose(
    question: string,
    options: ProductOption[],
  ): Promise<ProductOption | null> {
    return this.enqueue(async () => {
      this.output.write(`${question}\n${formatOptions(options)}\n`);
      for (;;) {
        const raw = await this.askRaw('Escolha o número:');
        const n = Number(raw);
        if (n === 0) return null;
        if (Number.isInteger(n) && n >= 1 && n <= options.length) {
          const chosen = options[n - 1];
          if (chosen) return chosen;
        }
        this.output.write('Opção inválida.\n');
      }
    });
  }

  withContext(prefix: string): Prompter {
    const normalizedPrefix = prefix.trim() ? `${prefix.trim()} ` : '';
    const parent = this;
    return {
      ask(question: string) {
        return parent.ask(`${normalizedPrefix}${question}`);
      },
      askInt(question: string) {
        return parent.askInt(`${normalizedPrefix}${question}`);
      },
      askInts(question: string) {
        return parent.askInts(`${normalizedPrefix}${question}`);
      },
      choose(question: string, options: ProductOption[]) {
        return parent.choose(`${normalizedPrefix}${question}`, options);
      },
      withContext(subPrefix: string) {
        return parent.withContext(`${normalizedPrefix}${subPrefix}`);
      },
    };
  }
}
