<!--
Sync Impact Report:
- Version change: N/A → 1.0.0
- List of modified principles:
    - [PRINCIPLE_1_NAME] → I. Spec-First & Plan-First
    - [PRINCIPLE_2_NAME] → II. Driver-Based Portals Automation
    - [PRINCIPLE_3_NAME] → III. Test-Driven Development (NON-NEGOTIABLE)
    - [PRINCIPLE_4_NAME] → IV. Result Pattern & Errors Management
    - [PRINCIPLE_5_NAME] → V. Domain & IO Separation
- Added sections: Tech Stack & Portals Constraints, Quality Gates & Workflow
- Templates requiring updates: 
    - ✅ .specify/templates/plan-template.md updated
    - ✅ .specify/templates/tasks-template.md updated
- Follow-up TODOs: None.
-->

# Orcamento CLI Constitution

## Core Principles

### I. Spec-First & Plan-First
Documentation precedes implementation. Every feature MUST have a `spec.md` and `plan.md` in the `specs/` or `docs/superpowers/` directory. No code changes are allowed without an approved plan that defines data models and technical discovery.

### II. Driver-Based Portals Automation
Portal interactions MUST be encapsulated in driver classes (`src/platforms`). Drivers handle legacy front-end quirks like session tokens (PR), `dispatchEvent` vs `trigger('change')`, and DOM manipulation. Domain logic MUST NOT leak into browser automation scripts.

### III. Test-Driven Development (NON-NEGOTIABLE)
TDD is mandatory. Write tests that fail first, then implement to satisfy them. Unit tests are required for all budget calculation and product rules logic. Integration tests are required for database and portal driver communication.

### IV. Result Pattern & Errors Management
All services and repositories MUST use the Result pattern (returning `{ ok: true, data }` or `{ ok: false, error }`). Exceptions are for unexpected infrastructure failures only. This ensures explicit handling of business-level failures (e.g., product out of stock).

### V. Domain & IO Separation
CLI commands (`src/cli`) only handle input gathering and orchestration. Core domain logic resides in `src/orcamento`. External IO (exports, writing to files, console prompts) must be isolated in `src/io` to ensure testability of the core logic without side effects.

## Tech Stack & Portals Constraints

- **Session PR**: Always extract session tokens dynamically from the URL; never hardcode session IDs.
- **Legacy Browser Events**: Prefer native `dispatchEvent` for elements with `onchange="..."` attributes to avoid jQuery's `trigger` limitations.
- **Persistence**: Use structured repositories for local quote caching and product rules management.
- **Local LLM Integration**: Utilize local Ollama (qwen2.5:14b) for intelligent client resolution and product matching.

## Quality Gates & Workflow

- **Tasks**: Sequential execution via `tasks.md` is required for multi-step features.
- **Validation**: Every modification to a portal driver must be accompanied by a technical discovery document or an update to `docs/portais-tecnicos.md`.
- **Verification**: Run `pnpm test` and `pnpm lint` after every major task to ensure no regressions.

## Governance

- This Constitution is the ultimate authority for development practices in this project.
- Amendments require a clear rationale and an update to this document.
- All Pull Requests and implementation phases must be reviewed against these principles.

**Version**: 1.0.0 | **Ratified**: 2026-06-09 | **Last Amended**: 2026-06-09

