# Freeflix — Makefile
# Docker Compose is the core entry point; these targets wrap common tasks.

COMPOSE      := docker compose
PROD_COMPOSE := docker compose -f docker-compose.yml
s ?=
d ?=

# --- webOS (stage 10) -------------------------------------------------------
# The TV-side tooling is @webos-tools/cli. @webosose/ares-cli is DEPRECATED and most
# tutorials are stale on this point. Install once:  npm install -g @webos-tools/cli
# Register the set once (its IP, not a hostname — the TV has no mDNS name here):
#   ares-setup-device --add $(TV) -i "host=<tv-ip>" -i "port=9922" -i "username=prisoner"
TV      ?= myTV
TV_APP  ?= com.freeflix.tv
TV_IPK  ?= com.freeflix.tv_0.1.0_all.ipk

.DEFAULT_GOAL := help
.PHONY: help up prod down build logs ps restart sh db test clean install \
        tv-serve tv-package tv-install tv-launch tv-inspect

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Build + start the full stack in dev mode, hot reload (d=1 for detached)
	$(COMPOSE) up --build $(if $(d),-d,)

prod: ## Build + start the production stack (no dev override)
	$(PROD_COMPOSE) up --build -d

down: ## Stop and remove containers
	$(COMPOSE) down

build: ## Rebuild all images
	$(COMPOSE) build

logs: ## Tail logs (s=backend for one service)
	$(COMPOSE) logs -f $(s)

ps: ## Show service status
	$(COMPOSE) ps

restart: ## Restart services (s=backend for one service)
	$(COMPOSE) restart $(s)

sh: ## Shell into a service (default backend; s=frontend)
	$(COMPOSE) exec $(or $(s),backend) sh

db: ## Open psql in the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-freeflix}

test: ## Run backend tests in-container
	$(COMPOSE) run --rm backend python -m pytest

clean: ## Stop, remove volumes/orphans, prune images, delete stray .DS_Store
	$(COMPOSE) down -v --remove-orphans
	-find . -name '.DS_Store' -delete
	-docker image prune -f

install: ## Local (non-docker) dependency install
	cd backend && poetry install
	cd frontend && npm install

tv-serve: ## webOS: host the shell from this Mac and launch it on the TV (the inner loop, no packaging)
	ares-launch -H ./webos -d $(TV)

tv-package: ## webOS: build the IPK (only to pin a build; --no-minify keeps it readable on the set)
	ares-package --no-minify ./webos

tv-install: ## webOS: install the built IPK on the TV
	ares-install --device $(TV) ./$(TV_IPK)

tv-launch: ## webOS: launch the installed app
	ares-launch --device $(TV) $(TV_APP)

tv-inspect: ## webOS: open a remote devtools window on the running app
	ares-inspect --device $(TV) --app $(TV_APP) --open
