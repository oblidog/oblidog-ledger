SHELL := /bin/bash

.PHONY: help cmt dev-b dev-f demo-up demo-down e2e e2e-down pre test cov lint fmt hooks refresh

DEMO_COMPOSE := docker compose --env-file .env.demo -p oblidog-demo-local -f compose.yml -f compose.override.yml -f compose.demo.yml

help:
	@echo "Available targets:"
	@echo "  make cmt    - run commitizen commit flow"
	@echo "  make dev-b  - start backend with fastapi dev"
	@echo "  make dev-f  - start frontend dev server"
	@echo "  make demo-up - build and start the isolated local demo"
	@echo "  make demo-down - stop the isolated local demo"
	@echo "  make e2e    - run Playwright in an isolated Docker Compose project"
	@echo "  make e2e-down - remove the isolated e2e project and its test database"
	@echo "  make pre    - run pre-commit hooks on all files"
	@echo "  make test   - run backend tests"
	@echo "  make cov    - run backend coverage report"
	@echo "  make lint   - run backend mypy + ruff checks"
	@echo "  make fmt    - format backend code with ruff"
	@echo "  make hooks  - install git pre-commit and commit-msg hooks"
	@echo "  make refresh - update dev and synchronize Bun and Python dependencies"
	@echo "  make alembic - run alembic migrations to upgrade database schema"

cmt:
	bash ./scripts/cz.sh commit

dev-b:
	cd backend && uv run fastapi dev app/main.py

dev-f:
	bun run --filter frontend dev

demo-up:
	$(DEMO_COMPOSE) build backend frontend
	$(DEMO_COMPOSE) up --detach --wait db prestart backend frontend demo-seed

demo-down:
	$(DEMO_COMPOSE) down

e2e:
	docker compose -p findog-e2e -f compose.e2e.yml up --build --detach --wait backend mailcatcher
	docker compose -p findog-e2e -f compose.e2e.yml run --rm playwright

e2e-down:
	docker compose -p findog-e2e -f compose.e2e.yml down -v --remove-orphans

pre:
	cd backend && uv run pre-commit run --all-files

test:
	cd backend && uv run pytest tests/

cov:
	cd backend && uv run bash ./scripts/test.sh

lint:
	cd backend && uv run bash ./scripts/lint.sh

fmt:
	cd backend && uv run bash ./scripts/format.sh

hooks:
	cd backend && uv run pre-commit install --hook-type pre-commit --hook-type commit-msg

alembic:
	cd backend && uv run alembic upgrade head

refresh:
	git pull --ff-only origin dev
	bun install --frozen-lockfile
	uv sync
