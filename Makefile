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

.DEFAULT_GOAL := help

.PHONY: help \
        install update uninstall \
        start stop restart status logs logs-tail enable disable \
        deploy-cmds deploy-cmds-global clear-cmds \
        up down rebuild ps dlogs dhealth dexec-deploy \
        check

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
	id -u $(BOT_USER) >/dev/null 2>&1 || sudo useradd -r -s /bin/false $(BOT_USER)
	sudo mkdir -p $(INSTALL_DIR)
	sudo rsync -a --delete --exclude=node_modules --exclude=.git --exclude=temp ./ $(INSTALL_DIR)/
	sudo mkdir -p $(INSTALL_DIR)/temp
	sudo chown -R $(BOT_USER):$(BOT_USER) $(INSTALL_DIR)
	sudo install -m 600 -o root -g $(BOT_USER) .env $(ENV_FILE)
	cd $(INSTALL_DIR) && sudo -u $(BOT_USER) bun install --production
	sudo install -m 644 $(SERVICE_FILE) /etc/systemd/system/$(SERVICE_NAME).service
	sudo systemctl daemon-reload
	sudo systemctl enable --now $(SERVICE_NAME)

update: ## Pull, install deps, restart service (run inside $(INSTALL_DIR))
	sudo -u $(BOT_USER) git -C $(INSTALL_DIR) pull
	cd $(INSTALL_DIR) && sudo -u $(BOT_USER) bun install --production
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

deploy-cmds: ## Register slash cmds to GUILD_ID (run on install host)
	cd $(INSTALL_DIR) && sudo -u $(BOT_USER) bun run deploy

deploy-cmds-global: ## Register slash cmds globally (~1h propagation)
	cd $(INSTALL_DIR) && sudo -u $(BOT_USER) bun run deploy:global

clear-cmds: ## Clear guild slash cmds
	cd $(INSTALL_DIR) && sudo -u $(BOT_USER) bun run clear

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
