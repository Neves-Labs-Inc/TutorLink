"""`app.main`'s logging setup: `app.*` INFO records reach a handler under uvicorn's config."""

import io
import logging

from uvicorn.config import Config


def test_app_logger_info_reaches_a_handler_under_uvicorn_logging():
    app_logger = logging.getLogger("app")
    original_level = app_logger.level
    original_handlers = list(app_logger.handlers)

    try:
        Config("app.main:app").configure_logging()

        import app.main

        assert app.main.app is not None

        handler = next(h for h in app_logger.handlers if isinstance(h, logging.StreamHandler))
        stream = io.StringIO()
        handler.stream = stream

        logger = logging.getLogger("app.services.retention_scheduler")
        logger.info("retention purge: ran ok")

        output = stream.getvalue()

        assert output.count("retention purge: ran ok") == 1
        assert logger.propagate is True
    finally:
        app_logger.handlers = original_handlers
        app_logger.setLevel(original_level)
