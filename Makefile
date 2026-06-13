.PHONY: setup backend frontend dev seed test build

setup:
	cd backend && pip3 install -r requirements.txt
	cd frontend && npm install

backend:   ## run API on :8000
	cd backend && uvicorn app.main:app --reload --port 8000

frontend:  ## run Vite dev server on :5173 (proxies /api -> :8000)
	cd frontend && npm run dev

seed:      ## create the demo "Wandering Hero" project
	cd backend && python3 -m app.seed

test:
	cd backend && python3 -m pytest -q

build:     ## build the frontend into frontend/dist (served by the backend at /)
	cd frontend && npm run build
