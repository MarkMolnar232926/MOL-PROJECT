.PHONY: install dev api web test test-backend test-frontend lint format gen-api preview docker report export

PY ?= python3

install:
	cd backend && $(PY) -m pip install -e ".[dev]"
	cd frontend && npm install

# Start API (http://localhost:8000) and web (http://localhost:5173) together; Ctrl+C stops both.
dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && $(PY) -m uvicorn api.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

api:
	cd backend && $(PY) -m uvicorn api.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	cd backend && $(PY) -m pytest

test-frontend:
	cd frontend && npm test

lint:
	cd backend && ruff check . && ruff format --check .
	cd frontend && npm run typecheck

format:
	cd backend && ruff check --fix . && ruff format .

gen-api:
	cd frontend && npm run gen:api

# Parsed preview of an input workbook, e.g. make preview FILE=tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx
FILE ?= tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx
preview:
	cd backend && $(PY) -m recon.preview $(abspath $(FILE))

docker:
	docker compose up --build

# Matching summary, e.g. make report QR=--qr
QR ?=
report:
	cd backend && $(PY) -m recon.report $(abspath $(FILE)) $(QR)

# Reconciled workbook, e.g. make export OUT=out.xlsx ARGS="--accept-suggestions --qr"
OUT ?= reconciled.xlsx
ARGS ?=
export:
	cd backend && $(PY) -m recon.export $(abspath $(FILE)) -o $(abspath $(OUT)) $(ARGS)
