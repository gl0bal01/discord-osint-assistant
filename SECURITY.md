# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 3.x | Yes |
| < 3.0 | No |

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
URL-accepting commands block every non-globally-routable destination: private, loopback, link-local, CGNAT, reserved, multicast, documentation, and NAT64/6to4 ranges, IPv4-mapped IPv6 included (a `net.BlockList`). The check runs before the request (DNS pre-flight) and again at connect time in custom HTTP agents, so it covers IP literals, redirects and DNS rebinding. Unknown IP formats default to blocked (fail-safe). See [`utils/ssrf.js`](utils/ssrf.js).

### Authorization
- Commands restricted as a whole are mapped to a Discord permission (Administrator or Manage Server) in `RESTRICTED_COMMANDS` ([`utils/permissions.js`](utils/permissions.js)). The [README](README.md#security) lists every restricted command and option, and [docs/COMMANDS.md](docs/COMMANDS.md) shows each command's permission.
- A role in `OSINT_ALLOWED_ROLES` passes every `RESTRICTED_COMMANDS` gate, the Administrator one included
- Two options that change shared state check the permission themselves, and `OSINT_ALLOWED_ROLES` does not pass them: `/bob-ghunt type:login` (replaces the bot's Google session) requires Administrator, and `/bob-nike token:` (replaces the shared Nike token, answered ephemerally) requires Manage Server
- Guild whitelist (`ALLOWED_GUILD_IDS`) restricts which servers the bot operates in — it auto-leaves unauthorized servers

### Rate Limiting
Per-user cooldowns (3s light / 10s medium / 30s heavy commands; a command missing from `COMMAND_CATEGORIES` is light) and a per-user daily limit (`RATE_LIMIT_DAILY`, default 200) prevent abuse. [docs/COMMANDS.md](docs/COMMANDS.md) shows each command's tier. Check and record are atomic to prevent TOCTOU bypass. State is in-memory only and resets on restart — supervisors (systemd `Restart=always`, Docker `restart: unless-stopped`) are expected to restart rarely in steady state. A periodic prune (`startRateLimitPrune`) drops stale cooldowns and yesterday's daily counters. See [`utils/ratelimit.js`](utils/ratelimit.js).

### Structured Logging and Secret Redaction
All boot, lifecycle, and routing logs go through pino in JSON format ([`utils/logger.js`](utils/logger.js)). The redaction list censors `token`, `authorization`, `password`, `api_key`, `headers.authorization`, `headers.cookie`, plus every secret env var registered in `utils/config.js` (`DISCORD_TOKEN`, the AWS keys, every API key and token, `SECURITY_WEBHOOK_URL`), at the top level and one object deep. Errors logged under `err` go through a serializer that drops the HTTP request config, request and response from axios errors (their headers and URL query hold API keys). It keeps only status, method and the URL without its query string, and replaces any remaining occurrence of a known secret value in the message or stack with `[REDACTED]`. When adding a new secret env var, add it to `utils/config.js` OPTIONAL, the redact path list in `utils/logger.js` (both `NAME` and `*.NAME`), and `.env.example`; `tests/utils/env-contract.test.js` fails if one is missing. Pretty output via `pino-pretty` is dev-only (`NODE_ENV !== 'production' && stdout.isTTY`); production emits raw JSON for log aggregators.

### Fail-Loud Lifecycle
`uncaughtException` and `unhandledRejection` log a structured fatal record (`level=60`) and call `process.exit(1)` — they are no longer swallowed. The bot must run under a supervisor (systemd `Restart=always` or Docker `restart: unless-stopped`; PM2 is not supported). If pino itself fails to instantiate, the boot path falls back to `console.error` for the init failure and exits 1. There are no fallback shims that mask broken state.

### Healthcheck
`scripts/healthcheck.js` reads `./temp/.health/health.json` (`/app/temp/...` in the container; configurable via `HEALTH_FILE`) and exits 0 only when the Discord gateway state is `ready` and the heartbeat timestamp is within 30 seconds, OR when state is `shutting_down` within a 60-second grace window. Both windows are fixed in the script. ENOENT or stale state exits 1. The Dockerfile `HEALTHCHECK` calls this script every 30 seconds with a 15-second start period, so orchestrators detect actual gateway disconnection rather than mere process presence. The boot temp sweep and the hourly sweep both exclude `.health/` so the file is never deleted under the bot's feet.

### Metrics Endpoint (opt-in)
[`utils/metrics.js`](utils/metrics.js) exposes a Prometheus-format endpoint behind `METRICS_ENABLED=true` (default off). The HTTP server binds to `127.0.0.1` by default — exposing externally requires a reverse proxy with authentication. Metrics use a fresh `prom-client` `Registry()`, NOT the default registry, so no `process_*` or `nodejs_*` host-fingerprinting metrics leak. Counters cover command duration, error rate, ratelimit blocks, and Discord events.

### Security Webhook
`SECURITY_WEBHOOK_URL` is consumed by exactly one call site: `commands/redirect-chain.js notifyWebhook()`. It is intentionally not generalized into a global event sink because doing so without a per-event cooldown would create a webhook-fanout DDoS amplifier (a user spamming a command could exhaust the webhook). Do not import this env var from any other module.

### Data Handling
- Temporary files are cleaned up automatically after use; an hourly sweep removes anything older than 24h from `temp/` (excluding `.health/`)
- Command exports are copied to `reports/`, which is owner-only (`0700`/`0600`) and ephemeral by default: nothing survives a restart unless the operator points `REPORTS_DIR` at persistent storage ([Reports Archive](README.md#reports-archive)).
- API keys are loaded from environment variables, never hardcoded; child processes spawned via `safeSpawn` receive a stripped environment so secrets never leak to subprocesses
- Error messages shown to users are generic; detailed errors are logged server-side only via the structured logger

### Container Security
The `docker-compose.yml` enforces:
- `security_opt: no-new-privileges` — prevents privilege escalation
- `cap_drop: ALL` — drops all Linux capabilities
- `read_only: true` — read-only root filesystem (preserved through all production-readiness work)
- `tmpfs` mounts with size limits for `/app/temp`, `/app/reports` (both `mode=0700`, owned by `botuser`) and `/tmp`, plus the `/home/botuser` volume — these are the only writable paths; the app code is root-owned
- Memory limit (512MB) and PID limit (50)
- Non-root `botuser` in the Dockerfile
- `HEALTHCHECK` runs `bun run scripts/healthcheck.js` every 30s — not just `kill -0 1`

### systemd Deployment
`deploy/discord-osint-assistant.service` provides equivalent hardening for bare-metal deployments: `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `PrivateDevices=true`, `RestrictNamespaces=true`, `RestrictRealtime=true`, `LockPersonality=true`, plus `MemoryMax=512M` and `TasksMax=50` mirroring the Docker resource limits. `Restart=always` restarts the bot after any crash (fatal errors exit 1). There is no `WatchdogSec`: the bot doesn't send sd_notify keep-alives. Gateway health is in `temp/.health/health.json`; check it with `bun run scripts/healthcheck.js`. Reports go to the service's private `/tmp` (`REPORTS_DIR=/tmp/reports`), so they are wiped when the service stops. `make install`/`update` keep the code tree root-owned (read-only to the bot, as in the Docker image) with only `temp/` owned by `botuser`; the slash-command targets run as `botuser` in a transient `systemd-run` unit that reads the root-only env file like the service, so root never executes repo code; dependencies install with `--ignore-scripts`. `UMask=0077` keeps every file it writes owner-only, and the tools' state (GHunt session) lives in a private `HOME` under `/var/lib/discord-osint-assistant` (`StateDirectory`, mode `0700`).

### CI/CD
- GitHub Actions pinned to commit SHAs (not mutable tags)
- `npm audit` blocks the build at moderate severity for all dependencies (`audit` job) and at high severity for production dependencies (`--omit=dev`, `docker` job)
- Trivy blocks on fixable CRITICAL/HIGH library vulnerabilities in the default image; it scans the full image too, but only reports, since those findings are in the third-party OSINT tools
- CI builds the full image and fails if any CLI-backed command would be hidden for a missing tool (`scripts/check-tools.js`)
- Reproducible images: the base image is pinned by digest, the Python tools are pinned in `docker/osint/requirements.txt` (Dependabot pip), and nuclei, nuclei-templates and jwt_tool are pinned by version or commit in the Dockerfile
- `scripts/ci-local.sh` (`bun run ci`) mirrors every CI job locally, and the `.githooks/pre-push` hook runs it
- Secrets passed via environment variables, not embedded in URLs
- `.github/dependabot.yml` schedules weekly updates for bun, github-actions, pip (`/docker/osint`) and docker; bun updates are grouped into `production` and `development`. Auto-merge rules: [CONTRIBUTING.md](CONTRIBUTING.md#ci-workflows)

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
- Review structured logs for the audit trail (every command execution emits a `Command invoked` record with `command`, `userId`, `userTag`, `guildId`, and `guildName`)
