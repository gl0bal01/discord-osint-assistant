# Contributing to Discord OSINT Assistant

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Copy `.env.example` to `.env` and configure required variables
4. Start in dev mode: `bun run dev`
5. Deploy commands to your test server: `bun run deploy`

## Repository Layout

| Path | Contents |
|------|----------|
| `index.js` | Entry point: boot, guild whitelist, permission and rate-limit gates, command routing |
| `deploy-commands.js`, `clear-commands.js` | Standalone CLIs that register or clear slash commands through the Discord REST API |
| `commands/` | One slash command per file |
| `utils/` | Shared modules: validation, SSRF, process spawning, permissions, rate limits, logging, config registry |
| `scripts/` | `healthcheck.js` (Docker `HEALTHCHECK`), `smoke-test.js` (`bun run smoke`), `ci-local.sh` (`bun run ci`), `check-tools.js` (fails if a CLI-backed command would be hidden), `gen-commands-doc.js` (`bun run docs:commands`) |
| `addons/` | `GPS2MapUrl.config`: ExifTool composite tags that `/bob-exif` loads to build map links from GPS coordinates |
| `docker/osint/requirements.txt` | Pinned Python tools for the `full` Docker image |
| `deploy/` | systemd unit |
| `.githooks/` | Opt-in `pre-push` hook that runs `bun run ci` |
| `tests/` | Vitest suites: `commands/`, `utils/`, `integration/`, `scripts/`, `docs/` |
| `docs/` | `INSTALLATION.md`, and the generated `COMMANDS.md` |
| `reports/`, `temp/` | Runtime data (command exports, temp files, health state); gitignored |
| `package.json`, `bun.lock` | Scripts, dependencies (`bufferutil`/`utf-8-validate` are optional native accelerators for discord.js's WebSocket), security `overrides`; the lockfile every install uses with `--frozen-lockfile` |
| `.env.example` | Complete reference of every environment variable (checked by `tests/utils/env-contract.test.js`) |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | `slim`/`full` images and the hardened container runtime |
| `Makefile` | systemd and compose operations (`make help`) |
| `.github/` | CI workflows (below) and `dependabot.yml` |
| `eslint.config.js`, `knip.json`, `vitest.config.mjs` | Lint, unused-code check and test configuration |
| `.gitignore` | Secrets, runtime data and local tooling kept out of git (including `CLAUDE.md`, a local assistant guide) |
| `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` | Overview, security policy, this guide, MIT license |
| `CITATION.cff`, `zenodo.json` | Citation and Zenodo archive metadata (`update-doi.yml` refreshes CITATION on release) |

## Adding a New Command

1. Create `commands/your-command.js`. It must export:
   - `data`: a `SlashCommandBuilder` (import it from `discord.js`, not `@discordjs/builders`)
   - `execute(interaction)`: the async handler
   - `shutdown()` (optional): clears intervals and timers on graceful shutdown
2. Validate input with `utils/validation.js`. For external tools, use `safeSpawn`/`safeSpawnToFile` from `utils/process.js` — **never use string-interpolated shell commands**. Send every outbound request to a user-supplied URL through `utils/ssrf.js` (`validateUrlNotInternal`, `getSafeAxiosConfig()`).
3. Use `utils/temp.js` for temporary files and `utils/chunks.js` for Discord message length handling.
4. If the command wraps a CLI tool, export `requiresTool: [path-or-name, ...]` so the command is hidden where the tool is missing, and install the tool in the Dockerfile `full` stage (Python tools go in `docker/osint/requirements.txt`).
5. Set its cooldown tier in `COMMAND_CATEGORIES` ([`utils/ratelimit.js`](utils/ratelimit.js)); a command missing from it is `light` (3s).
6. If it needs a Discord permission, add it to `RESTRICTED_COMMANDS` ([`utils/permissions.js`](utils/permissions.js)).
7. For a new env var, register it in `utils/config.js` OPTIONAL and document it in `.env.example`. If it holds a secret, also add `NAME` and `*.NAME` to the `redact.paths` list in `utils/logger.js`. `tests/utils/env-contract.test.js` checks all three.
8. Add tests in `tests/commands/`.
9. Regenerate the command reference: `bun run docs:commands` (a test fails when `docs/COMMANDS.md` is stale).
10. Deploy: `bun run deploy`.

## Code Standards

- Do not add `require('dotenv').config()` in command files (loaded by index.js)
- Never expose `error.message` to Discord users — log via `utils/logger.js`, show generic messages
- Clean up temporary files in `finally` blocks
- Use `??` (nullish coalescing) for boolean defaults, not `||`
- Boot orchestration (command loading, guild whitelist, shutdown handler, temp sweep) lives in `utils/bootstrap.js` — keep `index.js` thin
- Per-command observability (duration timer, error counter) is wired in `index.js` routing layer, not inside `commands/*.js`. Do not import `utils/metrics.js` from a command file
- Never use `console.*` in `commands/`, `utils/` or `index.js` (ESLint `no-console` enforces it). Commands log through a child logger: `const logger = require('../utils/logger').child({ command: '<data.name>' });`. Log errors as `logger.error({ err: error }, 'short static message')` so the `err` serializer strips axios config and secrets.

## Testing

```bash
bun run test          # Run tests once
bun run test:watch    # Watch mode
bun run lint          # ESLint
bun run knip          # Unused files, exports and dependencies
bun run ci            # Mirror of every CI job (run by the pre-push hook)
```

Opt in to running the local CI mirror before anything leaves your machine with `git config core.hooksPath .githooks`. Write tests for new utilities in `tests/utils/` and for new commands in `tests/commands/`. Stub axios or `utils/process` with `vi.spyOn` before requiring the command: `vi.mock` does not intercept `require()`.

## CI Workflows

| Workflow | What it does |
|----------|--------------|
| `ci.yml` | On every push and pull request to `main`: test, lint and knip on Node 22/24/26, `npm audit`, both Docker images with Trivy scans, and a check that the `full` image ships every tool. `bun run ci` mirrors it locally. |
| `dependabot-auto-merge.yml` | Auto-merges Dependabot patch and minor updates once required checks pass. Never majors, never pip (the `full` image's OSINT tools). |
| `mirror.yml` | Mirrors the repository to Codeberg on every push to `main` and weekly. |
| `update-doi.yml` ("Update citation") | On a published release, updates `version` and `date-released` in `CITATION.cff`. |

Adding a step to `ci.yml` means adding it to `scripts/ci-local.sh` in the same commit.

## Pull Request Process

1. Create a feature branch from `main`
2. Write tests for new functionality
3. Ensure the local CI mirror passes: `bun run ci` (or `bun run ci:fast` while iterating)
4. Submit PR with a description of changes
