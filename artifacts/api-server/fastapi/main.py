from fastapi import FastAPI

from routes import router

app = FastAPI(
    title="ChatMaster API",
    version="0.1.0",
    description="Tenant-scoped API for ChatMaster workspaces and chatbot flows.",
)
app.include_router(router)


@app.get("/healthz", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
