# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | No |

## Reporting a Vulnerability

1. **Do NOT open a public GitHub issue.**
2. Use [GitHub's private vulnerability reporting](https://github.com/gl0bal01/discord-osint-assistant/security/advisories/new) or email the repository owner.
3. Include: description, steps to reproduce, and potential impact.
4. You will receive a response within 48 hours.

## Security Architecture

### Command Execution
All external tools run via `spawn()` with argument arrays — never shell string interpolation. Child processes receive a stripped environment containing only `PATH`, `HOME`, `LANG`, and `NODE_ENV` — no API keys, tokens, or secrets are inherited. See [`utils/process.js`](utils/process.js).

### Input Validation
User inputs are validated through centralized functions in [`utils/validation.js`](utils/validation.js) — domains, URLs, emails, usernames, and IP addresses each have dedicated validators. `sanitizeInput()` strips shell metacharacters, newlines, null bytes, and fullwidth Unicode bypass characters.

### SSRF Protection
URL-accepting commands validate resolved IPs against private ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fe80::, fc/fd) at both DNS resolution time and connect time via custom HTTP agents, preventing DNS rebinding attacks. Unknown IP formats default to blocked (fail-safe). See [`utils/ssrf.js`](utils/ssrf.js).

### Authorization
- Nuclei requires Administrator permission
- Sherlock, Maigret, GHunt, JWT, Rekognition, Monitor, Linkook, and xeuledoc require ManageGuild
- Additional roles can be granted access via `OSINT_ALLOWED_ROLES`
- Guild whitelist (`ALLOWED_GUILD_IDS`) restricts which servers the bot operates in — it auto-leaves unauthorized servers

See [`utils/permissions.js`](utils/permissions.js).

### Rate Limiting
Per-user cooldowns (3s light / 10s medium / 30s heavy commands) and configurable daily limits prevent abuse. Check and record are atomic to prevent TOCTOU bypass. State is in-memory only and resets on restart — supervisors (systemd `Restart=always`, Docker `restart: unless-stopped`) are expected to restart rarely in steady state. A periodic prune (`startRateLimitPrune`) drops stale cooldowns and yesterday's daily counters. See [`utils/ratelimit.js`](utils/ratelimit.js).

### Structured Logging and Secret Redaction
All boot, lifecycle, and routing logs go through pino in JSON format ([`utils/logger.js`](utils/logger.js)). The redaction list censors `token`, `authorization`, `password`, `api_key`, `headers.authorization`, `headers.cookie`, plus every named secret env var declared in `utils/config.js` (`DISCORD_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, scanner API keys, `NIKE_TOKEN`, `SECURITY_WEBHOOK_URL`). When adding a new secret env var, update both `utils/config.js` OPTIONAL and the redact path list in `utils/logger.js`. Pretty output via `pino-pretty` is dev-only (`NODE_ENV !== 'production' && stdout.isTTY`); production emits raw JSON for log aggregators.

### Fail-Loud Lifecycle
`uncaughtException` and `unhandledRejection` log a structured fatal record (`level=60`) and call `process.exit(1)` — they are no longer swallowed. The bot must run under a supervisor (systemd, Docker `restart`, PM2). If pino itself fails to instantiate, the boot path falls back to `console.error` for the init failure and exits 1. There are no fallback shims that mask broken state.

### Healthcheck
`scripts/healthcheck.js` reads `/app/temp/.health/health.json` (configurable via `HEALTH_FILE`) and exits 0 only when the Discord gateway state is `ready` and the heartbeat timestamp is within 30 seconds, OR when state is `shutting_down` within a 60-second grace window. ENOENT or stale state exits 1. The Dockerfile `HEALTHCHECK` calls this script every 30 seconds with a 15-second start period, so orchestrators detect actual gateway disconnection rather than mere process presence. The boot temp sweep and the hourly sweep both exclude `.health/` so the file is never deleted under the bot's feet.

### Metrics Endpoint (opt-in)
[`utils/metrics.js`](utils/metrics.js) exposes a Prometheus-format endpoint behind `METRICS_ENABLED=true` (default off). The HTTP server binds to `127.0.0.1` by default — exposing externally requires a reverse proxy with authentication. Metrics use a fresh `prom-client` `Registry()`, NOT the default registry, so no `process_*` or `nodejs_*` host-fingerprinting metrics leak. Counters cover command duration, error rate, ratelimit blocks, and Discord events.

### Security Webhook
`SECURITY_WEBHOOK_URL` is consumed by exactly one call site: `commands/redirect-chain.js notifyWebhook()`. It is intentionally not generalized into a global event sink because doing so without a per-event cooldown would create a webhook-fanout DDoS amplifier (a user spamming a command could exhaust the webhook). Per-URL throttling for that single consumer is tracked as follow-up work. Do not import this env var from any other module.

### Data Handling
- Temporary files are cleaned up automatically after use; an hourly sweep removes anything older than 24h from `temp/` (excluding `.health/`)
- No investigation data is persisted beyond the Discord message lifetime
- API keys are loaded from environment variables, never hardcoded; child processes spawned via `safeSpawn` receive a stripped environment so secrets never leak to subprocesses
- Error messages shown to users are generic; detailed errors are logged server-side only via the structured logger

### Container Security
The `docker-compose.yml` enforces:
- `security_opt: no-new-privileges` — prevents privilege escalation
- `cap_drop: ALL` — drops all Linux capabilities
- `read_only: true` — read-only root filesystem (preserved through all production-readiness work)
- `tmpfs` mounts with size limits for `/app/temp` and `/tmp` — these are the only writable paths
- Memory limit (512MB) and PID limit (50)
- Non-root `botuser` in the Dockerfile
- `HEALTHCHECK` runs `bun run scripts/healthcheck.js` every 30s — not just `kill -0 1`

### systemd Deployment
`deploy/discord-osint-assistant.service` provides equivalent hardening for bare-metal deployments: `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `PrivateDevices=true`, `RestrictNamespaces=true`, `RestrictRealtime=true`, `LockPersonality=true`, plus `MemoryMax=512M` and `TasksMax=50` mirroring the Docker resource limits. `WatchdogSec=60` ties the supervisor to the gateway healthcheck.

### CI/CD
- GitHub Actions pinned to commit SHAs (not mutable tags)
- `npm audit` runs on every push (warn level) and again as a blocking gate against `--omit=dev` (production deps only) at high severity
- Trivy scans the Docker image for known vulnerabilities
- Secrets passed via environment variables, not embedded in URLs
- `.github/dependabot.yml` schedules weekly updates for npm, github-actions, and docker — production dependency PRs are labeled separately from devDependencies

## Best Practices for Operators

- Set `.env` file permissions to `chmod 600 .env`
- Disable **Public Bot** in the Discord Developer Portal
- Set `ALLOWED_GUILD_IDS` to restrict which servers can use the bot
- Configure `OSINT_ALLOWED_ROLES` to restrict sensitive commands
- Use least-privilege IAM policies for AWS credentials
- Rotate API keys regularly
- Run under a supervisor that restarts on failure — the bot exits 1 on uncaught errors by design
- Ship logs to a JSON-aware aggregator (Loki, ELK, journald with `journalctl -o json`) — secrets are redacted at the source but log retention/access controls are still your responsibility
- If enabling `METRICS_ENABLED=true`, keep the `127.0.0.1` bind and front it with an authenticated reverse proxy before exposing externally
- Review structured logs for the audit trail (every command execution emits `commandName`, `userId`, `userTag`, `guildId`, and `phase`)
