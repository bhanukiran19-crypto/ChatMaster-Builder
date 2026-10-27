import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

import database
from routes import router
from webhook_routes import router as webhook_router
from webhook_service import webhook_delivery_worker


@asynccontextmanager
async def lifespan(_app: FastAPI):
    worker_task = None
    if database.engine.dialect.name == "postgresql":
        worker_task = asyncio.create_task(webhook_delivery_worker())
    try:
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
            try:
                await worker_task
            except asyncio.CancelledError:
                pass

app = FastAPI(
    title="ChatMaster API",
    version="0.1.0",
    description="Tenant-scoped API for ChatMaster workspaces, flows, and signed webhooks.",
    lifespan=lifespan,
)
app.include_router(router)
app.include_router(webhook_router)


@app.get("/healthz", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
