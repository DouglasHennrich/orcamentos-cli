import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type AgentBrowserRunner = (args: string[]) => Promise<RunResult>;
export type ExecFn = (args: string[]) => Promise<RunResult>;

/** Wraps an exec function so a stub can be injected in tests. */
export function makeRunner(exec: ExecFn): AgentBrowserRunner {
  return (args) => exec(args);
}

/** Real runner: shells out to the installed `agent-browser` CLI. */
export const realRunner: AgentBrowserRunner = makeRunner(
  (args) =>
    new Promise((resolve) => {
      execFile(
        'agent-browser',
        args,
        { maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            code: err ? 1 : 0,
          });
        },
      );
    }),
);

/** Headed runner: same as realRunner but launches browser in visible mode. */
export const headedRunner: AgentBrowserRunner = makeRunner(
  (args) =>
    new Promise((resolve) => {
      execFile(
        'agent-browser',
        ['--headed', ...args],
        { maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            code: err ? 1 : 0,
          });
        },
      );
    }),
);
