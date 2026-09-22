.PHONY: dev dev-api dev-web build preview test test-py lint typecheck test-e2e

dev:
	npm run dev

dev-api:
	npm run dev:api

dev-web:
	npm run dev:web

build:
	npm run build

preview:
	npm run preview

test:
	npm run test

test-py:
	.venv/bin/python -m pytest -q

lint:
	npm run lint

typecheck:
	npm run typecheck

test-e2e: build
	npm run test:e2e
