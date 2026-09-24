from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.db import check_database

router = APIRouter(tags=["health"])


@router.get("/health")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness() -> JSONResponse:
    dependencies = {"database": "ok" if check_database() else "error"}
    healthy = all(state == "ok" for state in dependencies.values())
    return JSONResponse(
        content=dependencies,
        status_code=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
    )
