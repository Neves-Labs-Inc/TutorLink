"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.routers import health

# No CORS middleware by design (D-012): the browser reaches this API same-origin through the
# Vite dev proxy. Do not add one.
app = FastAPI(title="TutorLink API", docs_url="/docs")

app.include_router(health.router)
