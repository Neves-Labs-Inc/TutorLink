# /// script
# dependencies = ["fastapi", "uvicorn[standard]", "twilio", "python-multipart"]
# ///
import logging
import sys

import uvicorn
from fastapi import FastAPI, Form, Response
from twilio.twiml.messaging_response import MessagingResponse

DEFAULT_PORT = 8001

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("whatsapp-test")

app = FastAPI()


@app.post("/webhook")
def receive_message(
    from_number: str = Form(alias="From"),
    body: str = Form(default="", alias="Body"),
    num_media: str = Form(default="0", alias="NumMedia"),
) -> Response:
    logger.info("Message from %s: %s", from_number, body)

    media_count = int(num_media)
    if media_count > 0:
        logger.info("Received %d media attachment(s)", media_count)

    reply = MessagingResponse()
    reply.message(f"Echo: {body}")

    return Response(content=str(reply), media_type="application/xml")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
