# Roberlo HTTPS Upgrade Block Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Roberlo-specific browser runners that disable Chromium's HTTPS Upgrade feature so the portal loads without the security interstitial that blocks headless and headed runs.

**Architecture:** Two new exported runners (`roberloRunner`, `roberloHeadedRunner`) are added to `agent-browser-runner.ts` using the existing `makePrefixedRunner` helper with the Chrome flag `--args "--disable-features=HttpsUpgrades"`. `batch-runner.ts` is updated to select these runners when the provider is `roberlo`.

**Tech Stack:** TypeScript, Vitest, agent-browser CLI (Chromium under the hood)

---

### Task 1: Add Roberlo-specific runners

**Files:**
- Modify: `src/platforms/agent-browser-runner.ts`
- Test: `tests/platforms/agent-browser-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/platforms/agent-browser-runner.test.ts` after the existing `describe` block:

```ts
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
```

- [ ] **Step 2: Run tests to confirm they pass**

Os testes usam `makePrefixedRunner` diretamente (já existe), portanto passam antes de qualquer novo export — eles validam o comportamento que os novos runners usarão.

```bash
pnpm test tests/platforms/agent-browser-runner.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Add the new exports to agent-browser-runner.ts**

Open `src/platforms/agent-browser-runner.ts`. After the `headedRunner` export (line 46), add:

```ts
/** Roberlo headless runner: disables Chrome HTTPS Upgrades to avoid the HTTP security interstitial. */
export const roberloRunner: AgentBrowserRunner = makePrefixedRunner(
  ['--args', '--disable-features=HttpsUpgrades'],
  execAgentBrowser,
);

/** Roberlo headed runner: visible window + disables Chrome HTTPS Upgrades. */
export const roberloHeadedRunner: AgentBrowserRunner = makePrefixedRunner(
  ['--headed', '--args', '--disable-features=HttpsUpgrades'],
  execAgentBrowser,
);
```

- [ ] **Step 4: Run tests again to confirm nothing broke**

```bash
pnpm test tests/platforms/agent-browser-runner.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/agent-browser-runner.ts tests/platforms/agent-browser-runner.test.ts
git commit -m "feat: add roberlo-specific runners with HttpsUpgrades disabled"
```

---

### Task 2: Use roberlo runners in batch-runner

**Files:**
- Modify: `src/orcamento/batch-runner.ts` (linha 9 import, linha 141 runner selection)

- [ ] **Step 1: Update the import in batch-runner.ts**

Change line 9 from:

```ts
import { headedRunner, realRunner } from '../platforms/agent-browser-runner.js';
```

to:

```ts
import { headedRunner, realRunner, roberloRunner, roberloHeadedRunner } from '../platforms/agent-browser-runner.js';
```

- [ ] **Step 2: Update the runner selection**

Change line 141 from:

```ts
    const runner = options.headed ? headedRunner : realRunner;
```

to:

```ts
    const runner = provider === 'roberlo'
      ? (options.headed ? roberloHeadedRunner : roberloRunner)
      : (options.headed ? headedRunner : realRunner);
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
pnpm build
```

Expected: exits with code 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/orcamento/batch-runner.ts
git commit -m "fix: use roberlo runners in batch-runner to bypass HTTPS upgrade interstitial"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Run a Roberlo order in headed mode**

```bash
pnpm dev -- --headed --provider roberlo pedidos.ts
```

Expected: the browser opens, navigates directly to `http://52.67.57.130/portal/U_PortalLogin.apw` **without** showing the "site not secure" interstitial, and the login form appears.

- [ ] **Step 2: Run headless**

```bash
pnpm dev -- --provider roberlo pedidos.ts
```

Expected: run completes without `net::ERR_BLOCKED_BY_CLIENT` in stderr.
