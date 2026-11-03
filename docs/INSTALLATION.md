# Installation Guide

## Prerequisites

- **Node.js** >= 22.12 ([download](https://nodejs.org/))
- **Bun** ([install](https://bun.sh/)) — the package manager, and the runtime of the Docker image, the systemd unit and the `Makefile`. Only a manual `node index.js` run works without it.
- A **Discord bot token** — see [Discord setup](#discord-bot-setup) below
- **Docker** (optional) for the [container path](#docker-deployment)
- **systemd path** only: `git`, `rsync`, `sudo`, `make` and systemd (`systemd-run`); Bun installed at `/usr/bin/bun` (the unit's `ExecStart`). `make install` checks these first.

## Quick Start

```bash
git clone https://github.com/gl0bal01/discord-osint-assistant.git
cd discord-osint-assistant
bun install
cp .env.example .env    # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
bun run deploy          # register slash commands with your server
bun run start
```

The bot starts with just `DISCORD_TOKEN` and `CLIENT_ID`. All other API keys and external tools are optional — commands that need them will tell you what's missing.

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.

2. Under **Bot**:
   - Click "Reset Token" and copy it — this is your `DISCORD_TOKEN`
   - Disable **Public Bot** (so only you can invite it)
   - No privileged intent is needed: the bot uses only the `Guilds` intent (slash commands)

3. Under **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: Send Messages, Embed Links, Attach Files, Use Application Commands
   - Copy the generated URL and open it to invite the bot to your server

4. Copy the **Application ID** from the General Information page — this is your `CLIENT_ID`.

5. Right-click your Discord server name > Copy Server ID — this is your `GUILD_ID`. (Enable Developer Mode in Discord settings if you don't see this option.) Only `bun run deploy` reads it; the bot itself does not.

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. [`.env.example`](../.env.example) is the complete reference: every variable the bot reads, grouped and commented, with its default. A test fails when the code reads a variable that is missing from it. Only `DISCORD_TOKEN` and `CLIENT_ID` are required; `GUILD_ID` is read only by `bun run deploy`.

### API Keys

Where to get each key. All optional — each command degrades gracefully without its key.

| Variable | Service | Used by |
|----------|---------|---------|
| `DNSDUMPSTER_TOKEN` | [DNSDumpster](https://dnsdumpster.com/) | `/bob-dns` |
| `WHOXY_API_KEY` | [Whoxy](https://www.whoxy.com/) | `/bob-whoxy` |
| `HOSTIO_API_KEY` | [Host.io](https://host.io/) | `/bob-hostio` |
| `AVIATIONSTACK_API_KEY` | [AviationStack](https://aviationstack.com/) | `/bob-flight` |
| `AIRPORTDB_API_KEY` | [AirportDB](https://airportdb.io/) | `/bob-airport` |
| `PAPPERS_API_KEY` | [Pappers](https://www.pappers.fr/) | `/bob-pappers` |
| `AI_API_KEY` | [1min.ai](https://1min.ai/) | `/bob-chat`, `/bob-upload` |
| `NIKE_TOKEN` | Nike Run Club (expires after about 1 hour; members with Manage Server can replace it in memory with `/bob-nike token:`) | `/bob-nike` |
| `ETHERSCAN_API_KEY` | [Etherscan](https://etherscan.io/apis) (API V2: one key for every EVM chain; BNB Chain needs a paid plan) | `/bob-blockchain` (ETH, BSC, Polygon, testnets, trace) |
| `AWS_ACCESS_KEY_ID` | AWS | `/bob-rekognition` |
| `AWS_SECRET_ACCESS_KEY` | AWS | `/bob-rekognition` |
| `AWS_REGION` | AWS (default: `us-east-1`) | `/bob-rekognition` |

## External Tools

These CLI tools are optional. Install the ones you want to use, or use the `full` Docker image, which ships all of them:

| Tool | Install | Commands | Path override |
|------|---------|----------|---------------|
| [Sherlock](https://github.com/sherlock-project/sherlock) | `pip install sherlock-project` | `/bob-sherlock` | `SHERLOCK_PATH` |
| [Maigret](https://github.com/soxoj/maigret) | `pip install maigret` | `/bob-maigret` | `MAIGRET_PATH` |
| [Nuclei](https://github.com/projectdiscovery/nuclei) | `go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`, plus [nuclei-templates](https://github.com/projectdiscovery/nuclei-templates) | `/bob-nuclei` | `NUCLEI_PATH`; templates: `NUCLEI_TEMPLATE_PATH` (default `/opt/nuclei-templates/http/osint/user-enumeration`) |
| [ExifTool](https://exiftool.org/) | `apt install exiftool` / `brew install exiftool` | `/bob-exif` | `EXIFTOOL_PATH` |
| [GHunt](https://github.com/mxrch/GHunt) | `pip install ghunt` | `/bob-ghunt` | `PATH` only; session file: `GHUNT_CREDS_PATH` |
| [xeuledoc](https://github.com/Malfrats/xeuledoc) | `pip install xeuledoc` | `/bob-xeuledoc` | `PATH` only |
| [Linkook](https://github.com/JackJuly/linkook) | `pip install linkook` | `/bob-linkook` | `PATH` only |
| [jwt_tool](https://github.com/ticarpi/jwt_tool) | Clone it to `/opt/tools/jwt_tool` with its own `venv/` (see the repo), or put `jwt_tool` on `PATH` | `/bob-jwt` | `JWT_TOOL_PATH`; wordlist: `JWT_WORDLIST` |

If a tool isn't installed, its command is hidden: `bun run deploy` skips it and the bot doesn't load it. Install the tool and re-run deploy to bring the command back.

`/bob-jwt crack mode:dict` uses `JWT_WORDLIST`, by default `<JWT_TOOL_PATH>/jwt-common.txt`: the 130 common secrets bundled with jwt_tool. For a bigger list such as rockyou, mount it (Docker) or copy it to the host and point `JWT_WORDLIST` at it.

## Docker Deployment

One Dockerfile builds two images; `BOT_TARGET` in `.env` picks one:

| `BOT_TARGET` | Contents | Commands |
|--------------|----------|----------|
| `slim` (default) | Bun + npm deps only | 24 (CLI-backed ones hidden) |
| `full` | adds Sherlock, Maigret, GHunt, xeuledoc, Linkook, jwt_tool, Nuclei + templates, ExifTool (~1 GB more) | all 32 |

```bash
cp .env.example .env                        # DISCORD_TOKEN, CLIENT_ID, GUILD_ID; optional BOT_TARGET=full
docker compose up -d --build                # or: make up
docker compose exec bot bun run deploy      # or: make dexec-deploy; re-run after switching image
```

Run `deploy` inside the container: it registers only the commands whose tools exist there. `/home/botuser` is a named volume (`bot-home`), so the GHunt login (`/bob-ghunt type:login`) persists across restarts.

The `docker-compose.yml` includes security hardening: non-root user, dropped capabilities, read-only filesystem, memory/PID limits, and tmpfs mounts. See [Container Security](../SECURITY.md#container-security).

The tools are pinned (`docker/osint/requirements.txt`, and version or commit `ARG`s in the Dockerfile) and sit in their own cached layer, so rebuilding after a code change takes seconds. Dependabot proposes upgrades for the Python tools and the base image; the Nuclei, nuclei-templates and jwt_tool pins are bumped by hand.

Day-to-day: `make dlogs` (follow logs), `make dhealth` (healthcheck state), `make rebuild` (rebuild and recreate), `make down` (stop and remove). To check every command against the live APIs in a throwaway container from the same image: `docker compose run --rm bot bun run smoke` (or `make smoke`). `make ci` runs every CI job locally. Commands whose API key is unset, or whose tool isn't in the image, are skipped by the smoke test.

## systemd Deployment

`deploy/discord-osint-assistant.service` runs the bot as `botuser` from `/opt/discord-osint-assistant` with `Restart=always` and full sandboxing ([details](../SECURITY.md#systemd-deployment)). Its `ExecStart` is `/usr/bin/bun run start`, so Bun must be installed at `/usr/bin/bun`.

```bash
cp .env.example .env    # fill in; make install copies it to /etc/discord-osint-assistant.env
make install            # create botuser, sync the committed HEAD to /opt/discord-osint-assistant, install deps, enable + start the unit
make deploy-cmds        # register the slash commands (loads /etc/discord-osint-assistant.env)
make logs-tail          # follow journald
```

- **Code**: `make install` and `make update` ship this checkout's committed `HEAD` (`git archive`), never uncommitted changes or untracked files.
- **Updates**: `make update` does not run `git pull`. Run `git pull` yourself, then `make update`: it syncs `HEAD` to the install directory, runs `bun install --production`, and restarts the service.
- **Ownership**: the code tree is root-owned and read-only to the bot; only `temp/` belongs to `botuser`.
- **Secrets**: the service reads `/etc/discord-osint-assistant.env` (mode `0600`, root only). `make install` copies it from `./.env`; `make update` does not, so after the first install edit `/etc/discord-osint-assistant.env` and run `make restart`.
- **Install path**: `INSTALL_DIR` defaults to `/opt/discord-osint-assistant`. The unit's `WorkingDirectory` and `ReadWritePaths` use that path too, so changing `INSTALL_DIR` means editing the unit as well.
- **Reports**: they go to the service's private `/tmp` and are wiped when it stops; see [Reports Archive](../README.md#reports-archive) to keep them.
- **Tool state**: `botuser` has no home and the unit sets `ProtectHome=true`, so the unit gives the service a private, persistent `HOME` at `/var/lib/discord-osint-assistant` (`StateDirectory`). The GHunt login (`/bob-ghunt type:login`, read by the `ghunt` CLI from `$HOME/.malfrats`) survives restarts there; leave `GHUNT_CREDS_PATH` unset.
- `make deploy-cmds`, `make deploy-cmds-global`, `make clear-cmds` and `make clear-cmds-global` register or clear slash commands as `botuser`, in a transient systemd unit that reads the installed env file exactly like the service. `make uninstall` removes the unit and keeps the install directory and the env file. `make help` lists every target.

## Command Deployment

```bash
# Deploy to your test server (instant, uses GUILD_ID)
bun run deploy

# Deploy globally (takes up to 1 hour to propagate)
bun run deploy:global

# Clear and redeploy (useful if commands get stuck)
bun run redeploy
```

[docs/COMMANDS.md](COMMANDS.md) lists every command and option that `deploy` registers.

## Verification

After starting the bot, run `/bob-health` in Discord:

- `/bob-health` reports the overall status, the Discord connection and system usage; `detailed:true` adds detailed system information.
- `check-apis:true` tests the DNSDumpster, Whoxy and Host.io keys only.
- `check-tools:true` lists every CLI-backed command and whether its tool's executable is present (it is not run):
  - 🟢 present, command loaded
  - ⚪ not installed, command hidden (all of them in the `slim` image); this does not change the overall status
  - 🔴 gone since boot: the command is still loaded and will fail (status degraded)
  - 🟡 installed since boot: restart the bot to load the command
  - 🔴 `<file>.js: failed to load`: a command file in `commands/` throws when loaded (status degraded)

The boot log's `Commands loaded` line lists the commands hidden at boot under `missingTool`, and `bun scripts/check-tools.js` exits 1 when any CLI-backed command would be hidden for a missing tool.

## Troubleshooting

**Bot doesn't respond to commands** — run `bun run deploy` to register commands, then check that the bot has the correct permissions in your server.

**"DISCORD_TOKEN missing"** — the bot validates required env vars at startup. Make sure `.env` exists and `DISCORD_TOKEN` is set.

**API command returns an error** — check that the corresponding API key is set in `.env`. For DNSDumpster, Whoxy and Host.io, `/bob-health check-apis:true` tests the key.

**A tool command is missing in Discord** — its tool isn't installed where `deploy` ran. Install it (or use `BOT_TARGET=full`), make sure it's in your PATH or set the path via env var where one exists (e.g., `SHERLOCK_PATH=/usr/local/bin/sherlock`), then re-run `bun run deploy`.

**Commands not showing in Discord** — slash commands can take up to an hour to appear for global deployments. Use guild deployment (`bun run deploy`) for instant registration.
