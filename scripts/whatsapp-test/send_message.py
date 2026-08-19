# /// script
# dependencies = ["twilio", "python-dotenv"]
# ///
import argparse
import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

type SendOutcome = str | TwilioRestException


@dataclass(frozen=True, slots=True)
class TwilioCredentials:
    account_sid: str
    auth_token: str
    whatsapp_number: str


@dataclass(frozen=True, slots=True)
class SendRequest:
    to: str
    body: str
    content_sid: str | None


def main() -> int:
    load_dotenv()

    request = parse_args()
    credentials = load_credentials()

    if credentials is None:
        print(
            "Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_NUMBER "
            "in the environment.",
            file=sys.stderr,
        )
        exit_code = 1
    else:
        outcome = send_message(credentials, request)

        if isinstance(outcome, TwilioRestException):
            print(f"Twilio rejected the message: {outcome.msg}", file=sys.stderr)
            exit_code = 1
        else:
            print(f"Sent. Message SID: {outcome}")
            exit_code = 0

    return exit_code


def parse_args() -> SendRequest:
    parser = argparse.ArgumentParser(description="Send a test WhatsApp message via Twilio")
    parser.add_argument("to", help="Recipient number in E.164 format, e.g. +15551234567")
    parser.add_argument("body", nargs="?", default="Hello from TutorLink's Twilio test script.")
    parser.add_argument(
        "--content-sid",
        dest="content_sid",
        default=None,
        help="Approved content template SID, required for the first message in a new "
        "24h session window",
    )
    args = parser.parse_args()

    return SendRequest(to=args.to, body=args.body, content_sid=args.content_sid)


def load_credentials() -> TwilioCredentials | None:
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    whatsapp_number = os.environ.get("TWILIO_WHATSAPP_NUMBER")

    if not account_sid or not auth_token or not whatsapp_number:
        result = None
    else:
        result = TwilioCredentials(account_sid, auth_token, whatsapp_number)

    return result


def send_message(credentials: TwilioCredentials, request: SendRequest) -> SendOutcome:
    client = Client(credentials.account_sid, credentials.auth_token)
    from_number = f"whatsapp:{credentials.whatsapp_number}"
    to_number = f"whatsapp:{request.to}"

    try:
        if request.content_sid is None:
            message = client.messages.create(from_=from_number, to=to_number, body=request.body)
        else:
            message = client.messages.create(
                from_=from_number, to=to_number, content_sid=request.content_sid
            )
        result: SendOutcome = message.sid
    except TwilioRestException as error:
        result = error

    return result


if __name__ == "__main__":
    sys.exit(main())
