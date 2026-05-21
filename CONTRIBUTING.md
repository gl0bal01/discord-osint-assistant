# Contributing to Discord OSINT Assistant

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Copy `.env.example` to `.env` and configure required variables
4. Start in dev mode: `bun run dev`
5. Deploy commands to your test server: `bun run deploy`

## Adding a New Command

1. Create a file in `commands/` named `your-command.js`
2. Export `data` (SlashCommandBuilder) and `execute` (async function)
3. Import validation functions from `utils/validation.js`
4. For external tool execution, use `safeSpawn`/`safeSpawnToFile` from `utils/process.js` — **never use string-interpolated shell commands**
5. Use `utils/temp.js` for temporary file management
6. Use `utils/chunks.js` for Discord message length handling
7. Deploy: `bun run deploy`

## Code Standards

- Import `SlashCommandBuilder` from `discord.js`, not `@discordjs/builders`
- Do not add `require('dotenv').config()` in command files (loaded by index.js)
- Validate all user input using `utils/validation.js`
- Never expose `error.message` to Discord users — log via `utils/logger.js`, show generic messages
- Clean up temporary files in `finally` blocks
- Use `??` (nullish coalescing) for boolean defaults, not `||`
- Boot orchestration (command loading, guild whitelist, shutdown handler, temp sweep) lives in `utils/bootstrap.js` — keep `index.js` under 120 lines
- Per-command observability (duration timer, error counter) is wired in `index.js` routing layer, not inside `commands/*.js`. Do not import `utils/metrics.js` from a command file
- `commands/*.js` may still use `console.*` for now — migration to `utils/logger.js` child loggers is tracked as a follow-up. New utility modules outside `commands/` should use the logger directly
- When adding a secret-bearing env var, update BOTH `utils/config.js` OPTIONAL and the `redact.paths` list in `utils/logger.js`

## Testing

```bash
bun run test          # Run tests once
bun run test:watch    # Watch mode
```

Write tests for any new utility functions in `tests/utils/`.

## Pull Request Process

1. Create a feature branch from `main`
2. Write tests for new functionality
3. Ensure all tests pass: `bun run test`
4. Run lint: `bun run lint`
5. Submit PR with a description of changes
