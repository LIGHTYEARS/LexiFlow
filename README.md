# LexiFlow

Personal English reading & expression learning Chrome extension.

## Status

🚧 **Early development** — Currently in M0 (Scaffold). See [PRD.md](PRD.md) for product requirements and [docs/technical-design/](docs/technical-design/) for technical specifications.

## Tech Stack

- **Extension Framework**: WXT + React + TypeScript (strict)
- **Storage**: Dexie 4 / IndexedDB
- **AI**: AI SDK Core + LiteLLM (user-configured)
- **Scheduling**: ts-fsrs (FSRS 6)
- **Search**: MiniSearch
- **Testing**: Vitest + Testing Library + MSW + Playwright

## Quick Start

```bash
# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Run all release verification checks
pnpm release:verify
```

## Project Structure

```
entrypoints/          # WXT entrypoints (background, content, popup, sidepanel, dashboard)
src/
  domain/             # Pure domain logic (no DOM/React/Chrome/SDK)
  application/        # Application services (use case orchestration)
  adapters/           # Third-party SDK thin wrappers
  infrastructure/     # Persistence (Dexie, storage, messaging)
  shared/             # Cross-layer: protocol, schema, UI, utils
  content-ui/         # Content script UI components (ShadowRoot)
tests/                # Unit, integration, component, E2E tests
scripts/              # Static gates, release verification
```

## Architecture Principles

1. **Domain-first** — Pure domain logic, no external framework dependencies
2. **Repository pattern** — Dexie is only accessed through Repository interfaces
3. **Typed messages** — All cross-context communication via Zod-validated ProtocolMap
4. **SDK-first** — No hand-written fetch, SSE parser, or custom ORM
5. **Local-first** — All data stored locally; no cloud; user owns credentials

See [docs/technical-design/01-architecture-and-technology-baseline.md](docs/technical-design/01-architecture-and-technology-baseline.md) for full architecture details.

## Milestones

| Milestone | Name | Status |
|---|---|---|
| M0 | Project Scaffold & Architecture Baseline | ✅ Done |
| M1 | Runtime & Communication Layer | ✅ Done |
| M2 | Data Layer & Domain Model | ⬜ Planned |
| M3 | Selection Trigger & Context Extraction | ⬜ Planned |
| M4 | AI Task Execution | ⬜ Planned |
| M5 | Capture, Dedup & Inbox | ⬜ Planned |
| M6 | Knowledge Library & Search | ⬜ Planned |
| M7 | FSRS Review & Error Tracking | ⬜ Planned |
| M8 | Backup, Import & Disaster Recovery | ⬜ Planned |
| M9 | Targeted Practice (P1) | ⬜ Planned |
| M10 | Release Gates & Verification | ⬜ Planned |
