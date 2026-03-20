# Discord OSINT Assistant

[![CI](https://github.com/gl0bal01/discord-osint-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/gl0bal01/discord-osint-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DOI](https://zenodo.org/badge/1007802575.svg)](https://doi.org/10.5281/zenodo.15741849)

A Discord bot that puts 30 OSINT tools behind slash commands. Run username searches, DNS lookups, blockchain analysis, image forensics, and more — without leaving your Discord server.

## Why Discord?

OSINT investigations are often collaborative. Discord gives you:

- **Shared workspace** — results land in channels where the whole team can see them, react, and follow up
- **Zero setup per user** — no one installs Python, clones repos, or manages API keys; they just type `/bob-sherlock username:target`
- **Access control built in** — Discord roles map directly to command permissions; sensitive tools like Nuclei require `ManageGuild`
- **Audit trail for free** — every command invocation is logged with user, guild, and timestamp

## Commands

31 commands across 8 categories:

**Identity & Social** — search usernames across 400+ platforms, generate username variations, investigate Google accounts
```
/bob-sherlock  /bob-maigret  /bob-nuclei  /bob-linkook
/bob-ghunt  /bob-generate-usernames
```

**Domain & Network** — DNS records, WHOIS history, hosting intel, web recon, redirect chains, favicon hashing
```
/bob-dns  /bob-whoxy  /bob-hostio  /bob-recon-web
/bob-redirect-chain  /bob-favicons
```

**Image & Media** — EXIF metadata with GPS mapping, AWS Rekognition facial analysis
```
/bob-exif  /bob-rekognition
```

**Blockchain** — multi-chain address lookup (BTC/ETH/BSC/Polygon), transaction history, address format detection
```
/bob-blockchain  /bob-blockchain-detect
```

**Transportation** — flight tracking, airport data, maritime vessel intelligence
```
/bob-aviation  /bob-airport  /bob-flight-number  /bob-vessels
```

**Business** — French company registry (Pappers), vehicle VIN lookup, Nike Run Club profile search
```
/bob-pappers  /bob-vpic  /bob-nike
```

**Analysis** — AI chat (multi-model), JWT decode/tamper/crack, Google Docs metadata, link extraction, Google dorking
```
/bob-chat  /bob-jwt  /bob-xeuledoc  /bob-extract-links  /bob-dork
```

**Ops** — target monitoring with alerts, system health checks
```
/bob-monitor  /bob-health
```

## Quick Start

```bash
git clone https://github.com/gl0bal01/discord-osint-assistant.git
cd discord-osint-assistant
bun install
cp .env.example .env   # add your DISCORD_TOKEN and CLIENT_ID
bun run deploy         # register slash commands
bun run start
```

Or with Docker:

```bash
cp .env.example .env   # configure tokens
docker compose up -d
```

The bot works with just a Discord token. API keys for third-party services (Whoxy, DNSDumpster, Host.io, AviationStack, AWS, etc.) unlock additional commands — see `.env.example` for the full list.

External CLI tools (Sherlock, Maigret, Nuclei, ExifTool, GHunt, xeuledoc, Linkook, jwt_tool) are optional. Commands that need a missing tool will tell you what to install.

## Security

This bot runs arbitrary external tools based on user input — security is not optional.

- **No shell injection** — all external tools execute via `spawn()` with argument arrays, never string interpolation. Child processes receive a stripped environment (PATH/HOME/LANG only — no API keys or tokens). See [`utils/process.js`](utils/process.js).
- **SSRF protection** — URL-accepting commands validate resolved IPs against private ranges at both DNS resolution and connect time, blocking DNS rebinding. See [`utils/ssrf.js`](utils/ssrf.js).
- **Input validation** — usernames, domains, URLs, emails, and IPs are validated through centralized functions. Shell metacharacters, null bytes, and Unicode bypass characters are stripped. See [`utils/validation.js`](utils/validation.js).
- **Permission gating** — Nuclei requires Administrator. Sherlock, Maigret, GHunt, JWT, Rekognition, Monitor, Linkook, and xeuledoc require ManageGuild. Configurable via `OSINT_ALLOWED_ROLES`. See [`utils/permissions.js`](utils/permissions.js).
- **Rate limiting** — per-user cooldowns (3s/10s/30s by command weight) and daily limits. See [`utils/ratelimit.js`](utils/ratelimit.js).
- **Container hardening** — multi-stage Dockerfile, non-root user, `cap_drop: ALL`, read-only filesystem, memory/PID limits, tmpfs mounts with size caps.
- **CI** — tests, lint, npm audit, and Trivy image scanning on every push. GitHub Actions pinned to commit SHAs.
- **Guild whitelist** — set `ALLOWED_GUILD_IDS` to restrict which servers the bot operates in. It auto-leaves unauthorized servers.

Full details in [SECURITY.md](SECURITY.md).

## Development

```bash
bun run dev          # auto-restart on changes
bun run test         # vitest
bun run lint         # eslint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding new commands. The short version: create a file in `commands/`, use `utils/validation.js` for input, `utils/process.js` for spawning tools, and never interpolate user input into shell strings.

## Requirements

- Node.js >= 20
- [Bun](https://bun.sh) (package manager)
- Discord bot token ([guide](https://discord.com/developers/docs/getting-started))

## License

MIT

---

Built for the OSINT community by [gl0bal01](https://github.com/gl0bal01).
