"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import queue, runtime
from .api import router
from .db import init_db, migrate

logging.basicConfig(level=logging.INFO)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.apply_to_settings()  # layer data/runtime.json over .env defaults
    init_db()
    migrate()  # backfill graphs on pre-existing DBs
    queue.start_workers()
    queue.requeue_pending()
    yield


app = FastAPI(title="anim-pipe", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
app.include_router(router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the built frontend if present (single-binary local app).
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
