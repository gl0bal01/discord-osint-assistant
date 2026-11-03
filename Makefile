# Discord OSINT Assistant — ops wrapper
#
# Wraps systemd + docker-compose lifecycle so common ops are one target.
# Day-to-day dev still uses `bun run <script>` (see package.json).

INSTALL_DIR    ?= /opt/discord-osint-assistant
SERVICE_NAME   ?= discord-osint-assistant
SERVICE_FILE   ?= deploy/$(SERVICE_NAME).service
ENV_FILE       ?= /etc/$(SERVICE_NAME).env
BOT_USER       ?= botuser
COMPOSE        ?= docker compose

# Ship the committed tree (HEAD, what CI tested), never the working tree: no
# untracked secrets, data or uncommitted code. Secrets come from $(ENV_FILE).
SYNC = tmp=$$(mktemp -d) && git archive HEAD | tar -x -C $$tmp && \
       sudo rsync -a --delete --exclude=node_modules --exclude=temp --exclude=reports $$tmp/ $(INSTALL_DIR)/; \
       status=$$?; rm -rf $$tmp; exit $$status

# Code is root-owned and read-only to the bot (like the Docker image); only temp/ is
# the bot's. Deps install as root with --ignore-scripts: no package code runs as root
# (the only native deps, bufferutil/utf-8-validate, ship prebuilds and are optional). systemd reads $(ENV_FILE) as root, so it stays root-only (0600).
OWN = sudo find $(INSTALL_DIR) -path $(INSTALL_DIR)/temp -prune -o -exec chown root:root {} + && \
      sudo install -d -o $(BOT_USER) -g $(BOT_USER) -m 0700 $(INSTALL_DIR)/temp && \
      sudo chown -R $(BOT_USER):$(BOT_USER) $(INSTALL_DIR)/temp

# Tools the install targets and the unit (ExecStart=/usr/bin/bun) rely on.
PREFLIGHT = test -x /usr/bin/bun || { echo "bun must be at /usr/bin/bun (the unit's ExecStart)"; exit 1; }; \
      for t in git rsync sudo systemctl systemd-run; do command -v $$t >/dev/null || { echo "missing: $$t"; exit 1; }; done

# Run a package.json script as $(BOT_USER) in a transient unit: systemd parses the root-only
# env file exactly as the service does, and root never executes the (deployable) code.
RUN_AS_BOT = sudo systemd-run --quiet --wait --pipe --collect --uid=$(BOT_USER) --gid=$(BOT_USER) \
      -p EnvironmentFile=$(ENV_FILE) -p WorkingDirectory=$(INSTALL_DIR) -p PrivateTmp=yes \
      -E HOME=/tmp /usr/bin/bun run $(1)

.DEFAULT_GOAL := help

.PHONY: help \
        install update uninstall \
        start stop restart status logs logs-tail enable disable \
        deploy-cmds deploy-cmds-global clear-cmds clear-cmds-global \
        up down rebuild ps dlogs dhealth dexec-deploy \
        ci smoke check

## ── meta ────────────────────────────────────────────────────────────────────

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "Vars: INSTALL_DIR=$(INSTALL_DIR)  SERVICE_NAME=$(SERVICE_NAME)  BOT_USER=$(BOT_USER)"

check: ## Print resolved config without doing anything
	@echo "INSTALL_DIR  = $(INSTALL_DIR)"
	@echo "SERVICE_NAME = $(SERVICE_NAME)"
	@echo "SERVICE_FILE = $(SERVICE_FILE)"
	@echo "ENV_FILE     = $(ENV_FILE)"
	@echo "BOT_USER     = $(BOT_USER)"
	@echo "COMPOSE      = $(COMPOSE)"

## ── systemd lifecycle ───────────────────────────────────────────────────────

install: ## Install bot under $(INSTALL_DIR) and enable systemd unit
	@test -f .env || (echo "missing .env in repo root" && exit 1)
	@$(PREFLIGHT)
	id -u $(BOT_USER) >/dev/null 2>&1 || sudo useradd -r -s /bin/false $(BOT_USER)
	sudo mkdir -p $(INSTALL_DIR)
	$(SYNC)
	$(OWN)
	sudo install -m 600 -o root -g root .env $(ENV_FILE)
	cd $(INSTALL_DIR) && sudo bun install --production --frozen-lockfile --ignore-scripts
	sudo install -m 644 $(SERVICE_FILE) /etc/systemd/system/$(SERVICE_NAME).service
	sudo systemctl daemon-reload
	sudo systemctl enable --now $(SERVICE_NAME)

update: ## Sync this checkout to $(INSTALL_DIR), install deps, restart service
	@$(PREFLIGHT)
	$(SYNC)
	$(OWN)
	cd $(INSTALL_DIR) && sudo bun install --production --frozen-lockfile --ignore-scripts
	sudo systemctl restart $(SERVICE_NAME)

uninstall: ## Disable + remove systemd unit (keeps $(INSTALL_DIR) and env)
	-sudo systemctl disable --now $(SERVICE_NAME)
	sudo rm -f /etc/systemd/system/$(SERVICE_NAME).service
	sudo systemctl daemon-reload

start:   ## Start service
	sudo systemctl start $(SERVICE_NAME)
stop:    ## Stop service
	sudo systemctl stop $(SERVICE_NAME)
restart: ## Restart service
	sudo systemctl restart $(SERVICE_NAME)
status:  ## Service status
	sudo systemctl status $(SERVICE_NAME) --no-pager
enable:  ## Enable on boot
	sudo systemctl enable $(SERVICE_NAME)
disable: ## Disable on boot
	sudo systemctl disable $(SERVICE_NAME)

logs:      ## Last 200 journal lines
	sudo journalctl -u $(SERVICE_NAME) -n 200 --no-pager
logs-tail: ## Follow journal
	sudo journalctl -u $(SERVICE_NAME) -f

## ── slash command registration ──────────────────────────────────────────────

# One-shot REST CLIs: the install dir has no .env by design, so they use $(ENV_FILE).
deploy-cmds: ## Register slash cmds to GUILD_ID (run on install host)
	$(call RUN_AS_BOT,deploy)

deploy-cmds-global: ## Register slash cmds globally (~1h propagation)
	$(call RUN_AS_BOT,deploy:global)

clear-cmds: ## Clear guild slash cmds
	$(call RUN_AS_BOT,clear)

clear-cmds-global: ## Clear global slash cmds
	$(call RUN_AS_BOT,clear:global)

## ── docker compose lifecycle ────────────────────────────────────────────────

up:      ## Build + start container detached
	$(COMPOSE) up -d --build
down:    ## Stop and remove container
	$(COMPOSE) down
rebuild: ## Rebuild image and recreate container
	$(COMPOSE) up -d --build --force-recreate
ps:      ## List compose services
	$(COMPOSE) ps
dlogs:   ## Follow container logs
	$(COMPOSE) logs -f
dhealth: ## Show container healthcheck state
	@cid=$$($(COMPOSE) ps -q bot); \
	test -n "$$cid" || (echo "container not running" && exit 1); \
	docker inspect --format '{{json .State.Health}}' $$cid | python3 -m json.tool 2>/dev/null || \
	docker inspect --format '{{json .State.Health}}' $$cid

dexec-deploy: ## Register slash cmds inside running container
	$(COMPOSE) exec bot bun run deploy

## ── checks (run before pushing) ─────────────────────────────────────────────

ci:      ## Run every CI job locally (Node 22/24/26, audits, both images, Trivy)
	bun run ci
smoke:   ## Run every command against the live APIs in a throwaway container
	$(COMPOSE) run --rm bot bun run smoke
