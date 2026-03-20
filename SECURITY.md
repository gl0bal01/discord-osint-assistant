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
Per-user cooldowns (3s light / 10s medium / 30s heavy commands) and configurable daily limits prevent abuse. Check and record are atomic to prevent TOCTOU bypass. See [`utils/ratelimit.js`](utils/ratelimit.js).

### Data Handling
- Temporary files are cleaned up automatically after use
- No investigation data is persisted beyond the Discord message lifetime
- API keys are loaded from environment variables, never hardcoded
- Error messages shown to users are generic; detailed errors are logged server-side only

### Container Security
The `docker-compose.yml` enforces:
- `security_opt: no-new-privileges` — prevents privilege escalation
- `cap_drop: ALL` — drops all Linux capabilities
- `read_only: true` — read-only root filesystem
- `tmpfs` mounts with size limits for `/app/temp` and `/tmp`
- Memory limit (512MB) and PID limit (50)
- Non-root `botuser` in the Dockerfile

### CI/CD
- GitHub Actions pinned to commit SHAs (not mutable tags)
- `npm audit` runs on every push
- Trivy scans the Docker image for known vulnerabilities
- Secrets passed via environment variables, not embedded in URLs

## Best Practices for Operators

- Set `.env` file permissions to `chmod 600 .env`
- Disable **Public Bot** in the Discord Developer Portal
- Set `ALLOWED_GUILD_IDS` to restrict which servers can use the bot
- Configure `OSINT_ALLOWED_ROLES` to restrict sensitive commands
- Use least-privilege IAM policies for AWS credentials
- Rotate API keys regularly
- Review server logs for audit trail (command usage is logged with user, guild, and timestamp)
