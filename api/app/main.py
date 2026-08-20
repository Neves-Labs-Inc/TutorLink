from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.routers import auth, exceptions, health, users

# No CORS middleware by design (D-012): the browser reaches this API same-origin through the
# Vite dev proxy. Do not add one.
app = FastAPI(title="TutorLink API", docs_url="/docs")

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(exceptions.router)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first_error = exc.errors()[0]
    location = ".".join(str(part) for part in first_error["loc"] if part != "body")
    message = first_error["msg"]
    detail = f"{location}: {message}" if location else message

    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": detail})
