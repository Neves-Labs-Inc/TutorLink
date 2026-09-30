"""Mounts the compiled dashboard onto the API, replacing Caddy's `try_files` directive.

The Caddyfile it replaces answered every request Caddy's other rules did not claim with
`index.html`, so the SPA's client-side router could handle any path the user typed or refreshed.
`mount_dashboard` reproduces that with three rules, tried in order: a request under `api`, `auth`
or `webhook` is this API's own surface and never falls through to the dashboard, even when the
underlying route does not exist (REQ-082.4 — the Caddyfile's "webhook gets forgotten" hazard,
closed structurally rather than by remembering to update a proxy config); a request naming one of
the files Vite emitted at the top of `dist/` (`favicon.svg`, `index.html`) is that file; and
everything else is `index.html`, because the dashboard's router — not this API — decides whether
that path is a real page or a 404. The set of top-level names is computed once at mount time and
membership is checked by name only, never by joining the request path onto the filesystem, so a
request cannot walk out of `dist_dir` no matter what it encodes.
"""

import os
from pathlib import Path

from fastapi import FastAPI, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

RESERVED_PREFIXES = ("api", "auth", "webhook")


def mount_dashboard(app: FastAPI, *, dist_dir: Path) -> None:
    index_file = dist_dir / "index.html"
    if not index_file.is_file():
        raise RuntimeError(f"DASHBOARD_DIST_DIR is set but {index_file} does not exist")

    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="dashboard-assets")

    top_level_files = {entry.name for entry in os.scandir(dist_dir) if entry.is_file()}

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    def serve_dashboard(path: str) -> FileResponse | JSONResponse:
        first_segment = path.split("/", 1)[0]

        if first_segment in RESERVED_PREFIXES:
            response: FileResponse | JSONResponse = JSONResponse(
                {"detail": "Not Found"}, status_code=status.HTTP_404_NOT_FOUND
            )
        elif path in top_level_files:
            response = FileResponse(dist_dir / path)
        else:
            response = FileResponse(index_file, headers={"Cache-Control": "no-cache"})

        return response
