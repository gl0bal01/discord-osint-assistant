# Installation Guide

## Prerequisites

- **Node.js** >= 20 ([download](https://nodejs.org/))
- **Bun** ([install](https://bun.sh/)) — used as the package manager
- A **Discord bot token** — see [Discord setup](#discord-bot-setup) below

## Quick Start

```bash
git clone https://github.com/gl0bal01/discord-osint-assistant.git
cd discord-osint-assistant
bun install
cp .env.example .env    # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
bun run deploy          # register slash commands with your server
bun run start
```

The bot starts with just a Discord token. All other API keys and external tools are optional — commands that need them will tell you what's missing.

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.

2. Under **Bot**:
   - Click "Reset Token" and copy it — this is your `DISCORD_TOKEN`
   - Disable **Public Bot** (so only you can invite it)
   - Enable **Server Members Intent** and **Message Content Intent**

3. Under **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: Send Messages, Use Slash Commands, Attach Files, Embed Links, Read Message History
   - Copy the generated URL and open it to invite the bot to your server

4. Copy the **Application ID** from the General Information page — this is your `CLIENT_ID`.

5. Right-click your Discord server name > Copy Server ID — this is your `GUILD_ID`. (Enable Developer Mode in Discord settings if you don't see this option.)

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. Here's what each variable does:

**Required:**

| Variable | Purpose |
|----------|---------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `CLIENT_ID` | Application ID from Discord Developer Portal |
| `GUILD_ID` | Server ID for guild-scoped command deployment |

**Access Control:**

| Variable | Purpose |
|----------|---------|
| `ALLOWED_GUILD_IDS` | Comma-separated server IDs the bot is allowed in (empty = all) |
| `OSINT_ALLOWED_ROLES` | Comma-separated role IDs that can use restricted commands |
| `MONITOR_CHANNEL_ID` | Channel ID for `/bob-monitor` alerts |

**API Keys** (all optional — commands degrade gracefully):

| Variable | Service | Used by |
|----------|---------|---------|
| `DNSDUMPSTER_TOKEN` | [DNSDumpster](https://dnsdumpster.com/) | `/bob-dns` |
| `WHOXY_API_KEY` | [Whoxy](https://www.whoxy.com/) | `/bob-whoxy` |
| `HOSTIO_API_KEY` | [Host.io](https://host.io/) | `/bob-hostio` |
| `AVIATIONSTACK_API_KEY` | [AviationStack](https://aviationstack.com/) | `/bob-aviation`, `/bob-flight-number` |
| `AIRPORTDB_API_KEY` | [AirportDB](https://airportdb.io/) | `/bob-airport` |
| `PAPPERS_API_KEY` | [Pappers](https://www.pappers.fr/) | `/bob-pappers` |
| `AI_API_KEY` | [1min.ai](https://1min.ai/) | `/bob-chat` |
| `VIRUSTOTAL_API_KEY` | [VirusTotal](https://www.virustotal.com/) | `/bob-recon-web` |
| `NIKE_TOKEN` | Nike Run Club | `/bob-nike` |
| `ETHERSCAN_API_KEY` | [Etherscan](https://etherscan.io/) | `/bob-blockchain` |
| `BSCSCAN_API_KEY` | [BscScan](https://bscscan.com/) | `/bob-blockchain` |
| `POLYGONSCAN_API_KEY` | [PolygonScan](https://polygonscan.com/) | `/bob-blockchain` |
| `AWS_ACCESS_KEY_ID` | AWS | `/bob-rekognition` |
| `AWS_SECRET_ACCESS_KEY` | AWS | `/bob-rekognition` |
| `AWS_REGION` | AWS (default: `us-east-1`) | `/bob-rekognition` |

## External Tools

These CLI tools are optional. Install the ones you want to use:

| Tool | Install | Commands |
|------|---------|----------|
| [Sherlock](https://github.com/sherlock-project/sherlock) | `pip install sherlock-project` | `/bob-sherlock` |
| [Maigret](https://github.com/soxoj/maigret) | `pip install maigret` | `/bob-maigret` |
| [Nuclei](https://github.com/projectdiscovery/nuclei) | `go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest` | `/bob-nuclei` |
| [ExifTool](https://exiftool.org/) | `apt install exiftool` / `brew install exiftool` | `/bob-exif` |
| [GHunt](https://github.com/mxrch/GHunt) | `pip install ghunt` | `/bob-ghunt` |
| [xeuledoc](https://github.com/Malfrats/xeuledoc) | `pip install xeuledoc` | `/bob-xeuledoc` |
| [Linkook](https://github.com/JackJuly/linkook) | See repo | `/bob-linkook` |
| [jwt_tool](https://github.com/ticarpi/jwt_tool) | See repo | `/bob-jwt` |

If a tool isn't installed, the corresponding command will return a clear "not installed" message instead of crashing.

To use a non-standard path, set the corresponding env var (e.g., `SHERLOCK_PATH=/opt/sherlock/bin/sherlock`).

## Docker Deployment

```bash
cp .env.example .env   # configure tokens
docker compose up -d
```

The `docker-compose.yml` includes security hardening: non-root user, dropped capabilities, read-only filesystem, memory/PID limits, and tmpfs mounts. See the [Security section](../README.md#security) in the README for details.

To add external tools to the Docker image, extend the Dockerfile:

```dockerfile
FROM discord-osint-assistant AS base
USER root
RUN pip install sherlock-project maigret
USER botuser
```

## Command Deployment

```bash
# Deploy to your test server (instant, uses GUILD_ID)
bun run deploy

# Deploy globally (takes up to 1 hour to propagate)
bun run deploy:global

# Clear and redeploy (useful if commands get stuck)
bun run redeploy
```

## Verification

After starting the bot, type `/bob-health detailed:true check-apis:true check-tools:true` in Discord to verify:
- Bot connectivity
- API key validity
- External tool availability

## Troubleshooting

**Bot doesn't respond to commands** — run `bun run deploy` to register commands, then check that the bot has the correct permissions in your server.

**"DISCORD_TOKEN missing"** — the bot validates required env vars at startup. Make sure `.env` exists and `DISCORD_TOKEN` is set.

**API command returns an error** — check that the corresponding API key is set in `.env`. Run `/bob-health check-apis:true` to test connectivity.

**External tool "not installed"** — install the tool and make sure it's in your PATH, or set the path explicitly via env var (e.g., `SHERLOCK_PATH=/usr/local/bin/sherlock`).

**Commands not showing in Discord** — slash commands can take up to an hour to appear for global deployments. Use guild deployment (`bun run deploy`) for instant registration.
