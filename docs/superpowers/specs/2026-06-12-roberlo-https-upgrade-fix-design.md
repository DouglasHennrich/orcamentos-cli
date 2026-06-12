# Design: Roberlo Provider — Fix HTTPS Upgrade Block

**Date:** 2026-06-12  
**Status:** Approved

## Problem

The Roberlo portal uses a plain HTTP URL with a raw IP address (`http://52.67.57.130/portal/U_PortalLogin.apw`). Modern Chromium automatically attempts to upgrade HTTP navigations to HTTPS (HTTPS Upgrades feature). When the HTTPS upgrade fails (the server has no TLS), Chromium shows a security interstitial requiring user confirmation before proceeding.

In the user's regular Chrome profile, this exception has been accepted and persisted. In `agent-browser`, every run starts with a clean profile — so the interstitial always appears and blocks navigation with `net::ERR_BLOCKED_BY_CLIENT`.

## Solution

Create Roberlo-specific browser runners that pass `--args "--disable-features=HttpsUpgrades"` to Chromium. This prevents the automatic HTTP→HTTPS upgrade before navigation, so the portal loads directly without the interstitial.

No changes are needed in `RoberloDriver` itself.

## Architecture

### `src/platforms/agent-browser-runner.ts`

Add two new exported runners:

```ts
export const roberloRunner: AgentBrowserRunner
export const roberloHeadedRunner: AgentBrowserRunner
```

Both use `makePrefixedRunner` with `--args "--disable-features=HttpsUpgrades"`. The headed variant also adds `--headed`.

### `src/orcamento/batch-runner.ts`

At the runner selection point, add a check for the `roberlo` platform:

```ts
const isRoberlo = platform === 'roberlo';
const runner = isRoberlo
  ? (options.headed ? roberloHeadedRunner : roberloRunner)
  : (options.headed ? headedRunner : realRunner);
```

## Data Flow

```
batch-runner selects runner
  └─ provider === 'roberlo'?
       yes → roberloRunner (headless) or roberloHeadedRunner (headed)
              └─ agent-browser --args "--disable-features=HttpsUpgrades" navigate <url>
                 └─ Chrome skips HTTPS upgrade → loads HTTP directly
       no  → realRunner / headedRunner (unchanged)
```

## Scope

- Files changed: `agent-browser-runner.ts`, `batch-runner.ts`
- No changes to `RoberloDriver`, other drivers, or any other provider
- The Chrome flag `--disable-features=HttpsUpgrades` has no effect on HTTPS sites, so it cannot regress AutoAmerica or other providers

## Testing

Manual verification: run a Roberlo order in headed mode and confirm the security interstitial no longer appears and the login page loads successfully. Headless run should complete without `ERR_BLOCKED_BY_CLIENT`.
