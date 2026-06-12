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

export function makePrefixedRunner(
  prefixArgs: string[],
  exec: ExecFn,
): AgentBrowserRunner {
  return (args) => exec([...prefixArgs, ...args]);
}

const execAgentBrowser: ExecFn = (args) =>
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
  });

/** Real runner: shells out to the installed `agent-browser` CLI with no mode flags. */
export const realRunner: AgentBrowserRunner = makeRunner(execAgentBrowser);

/** Headed runner: launches browser in visible mode. */
export const headedRunner: AgentBrowserRunner = makePrefixedRunner(
  ['--headed'],
  execAgentBrowser,
);

export const ROBERLO_ARGS = ['--args', '--disable-features=HttpsUpgrades'] as const;
export const ROBERLO_HEADED_ARGS = ['--headed', '--args', '--disable-features=HttpsUpgrades'] as const;

/** Roberlo headless runner: disables Chrome HTTPS Upgrades to avoid the HTTP security interstitial. */
export const roberloRunner: AgentBrowserRunner = makePrefixedRunner(
  [...ROBERLO_ARGS],
  execAgentBrowser,
);

/** Roberlo headed runner: visible window + disables Chrome HTTPS Upgrades. */
export const roberloHeadedRunner: AgentBrowserRunner = makePrefixedRunner(
  [...ROBERLO_HEADED_ARGS],
  execAgentBrowser,
);
