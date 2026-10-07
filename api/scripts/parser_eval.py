"""Hand-run evaluation of the intent parser against live Anthropic (map #102, ticket #104).

Promoted from the Spanish parser trial (`prototype/spanish-parser-trial`): the same 41 cases plus
the two grade edges, run through the real `parser_service.parse_intent`, so the shipped
`SYSTEM_PROMPT`, the `_ModelOutput` wire shape and the fold into `ParsedIntent` are what is
measured. It prints a results table, writes nothing, and exits non-zero unless every case passes.

It costs money and needs a key, so it is not part of CI, where the parser stays mocked. Run it
by hand after any change to the prompt, the output model or `MODEL`. From `api/`:

    UV_NATIVE_TLS=1 uv run python scripts/parser_eval.py

`ANTHROPIC_API_KEY` comes from the environment or from `api/.env`.
"""

import datetime
import os
import pathlib
import secrets
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

API_DIR = pathlib.Path(__file__).resolve().parents[1]

# `app.config` refuses to load without these; the parser never touches the database, so
# placeholders are enough for a run outside the app.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://eval:eval@localhost/eval")
os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
sys.path.insert(0, str(API_DIR))

import anthropic  # noqa: E402

from app.schemas.bot import AnswerKind, BotIntent, ParsedIntent  # noqa: E402
from app.services import parser_service  # noqa: E402

TODAY = datetime.date(2026, 10, 4)  # a Sunday, so "next Tuesday" and "el viernes" are unambiguous

# Generous next to the app's 4s budget: this measures what the model says, not its latency.
EVAL_TIMEOUT_SECONDS = 30.0
EVAL_MAX_RETRIES = 2
WORKERS = 6

EXIT_FAILED = 1
EXIT_NO_KEY = 2

MENU_Q = "I can book a session, cancel one, or move one to another time. What would you like to do?"
REMIND_Q = (
    "Ms Helping Hands can send you a weekly WhatsApp reminder to book your tutoring sessions. "
    "You can reply STOP at any time to end them. Is that OK?"
)
DATE_Q = 'Which day would you like? For example, "Tuesday" or "October 14".'
GRADE_Q = (
    "What grade is Ana in? For example, Kindergarten, 3rd grade or 10th grade. "
    "(K, Kindergarten or kínder = 0)"
)
NAME_Q = "What is your full name?"
CONFIRM_Q = (
    "To confirm: Tuesday, October 6, 4:00-5:00 PM: Math for Ana with Mr. Lee. Should I book it?"
)


@dataclass(frozen=True, slots=True)
class Case:
    """One message and what the parse must say about it.

    `None` in an expected column means "not scored"; `""` means the parse must give null.
    """

    case_id: str
    group: str
    step: str
    question: str
    answer_kind: AnswerKind
    body: str
    answer: str | None
    intent: BotIntent | None
    language: str | None
    reminders: str | None


def _case(
    case_id: str,
    group: str,
    step: str,
    question: str,
    answer_kind: AnswerKind,
    body: str,
    answer: str | None,
    intent: BotIntent | None,
    language: str | None,
    reminders: str | None,
) -> Case:
    return Case(
        case_id, group, step, question, answer_kind, body, answer, intent, language, reminders
    )


YES_NO = AnswerKind.YES_NO
DATE = AnswerKind.DATE
NUMBER = AnswerKind.NUMBER
TEXT = AnswerKind.TEXT

# fmt: off
CASES: tuple[Case, ...] = (
    _case("yn-1", "yes/no", "reminders", REMIND_Q, YES_NO, "sí", "yes", None, "es", None),
    _case("yn-2", "yes/no", "reminders", REMIND_Q, YES_NO, "Si", "yes", None, "es", None),
    _case("yn-3", "yes/no", "reminders", REMIND_Q, YES_NO, "claro que sí", "yes", None, "es", None),
    _case("yn-4", "yes/no", "reminders", REMIND_Q, YES_NO, "no gracias", "no", None, "es", None),
    _case("yn-5", "yes/no", "reminders", REMIND_Q, YES_NO, "ok", "yes", None, None, None),
    _case("yn-6", "yes/no", "reminders", REMIND_Q, YES_NO, "dale, está bien", "yes", None, "es", None),
    _case("yn-7", "yes/no", "reminders", REMIND_Q, YES_NO, "no sé, tal vez", "", None, "es", None),
    _case("yn-8", "yes/no", "book_confirm", CONFIRM_Q, YES_NO, "sí, resérvela por favor", "yes", None, "es", None),
    _case("dt-1", "dates", "book_date", DATE_Q, DATE, "mañana", "2026-10-05", None, "es", None),
    _case("dt-2", "dates", "book_date", DATE_Q, DATE, "el martes que viene", "2026-10-06", None, "es", None),
    _case("dt-3", "dates", "book_date", DATE_Q, DATE, "el 14 de octubre", "2026-10-14", None, "es", None),
    _case("dt-4", "dates", "book_date", DATE_Q, DATE, "pasado mañana", "2026-10-06", None, "es", None),
    _case("dt-5", "dates", "book_date", DATE_Q, DATE, "el viernes", "2026-10-09", None, "es", None),
    _case("gr-1", "grade", "child_grade", GRADE_Q, NUMBER, "quinto grado", "5", None, "es", None),
    _case("gr-2", "grade", "child_grade", GRADE_Q, NUMBER, "está en kínder", "0", None, "es", None),
    _case("gr-3", "grade", "child_grade", GRADE_Q, NUMBER, "3ro", "3", None, "es", None),
    _case("gr-4", "grade", "child_grade", GRADE_Q, NUMBER, "décimo", "10", None, "es", None),
    # The grade edges the bot range-checks itself: "K" is Kindergarten, and 13 must arrive as
    # 13, not be clamped by the parser, so the bot can say it tutors up to 12th grade.
    _case("gr-5", "grade", "child_grade", GRADE_Q, NUMBER, "K", "0", None, None, None),
    _case("gr-6", "grade", "child_grade", GRADE_Q, NUMBER, "13", "13", None, None, None),
    _case("nm-1", "names", "intake_name", NAME_Q, TEXT, "Me llamo María José Hernández", "María José Hernández", None, "es", None),
    _case("nm-2", "names", "intake_name", NAME_Q, TEXT, "José Núñez", "José Núñez", None, None, None),
    _case("bk-1", "intents", "menu", MENU_Q, TEXT, "quiero reservar una clase de matemáticas para Ana", None, BotIntent.BOOK, "es", None),
    _case("bk-2", "intents", "menu", MENU_Q, TEXT, "necesito agendar una sesión", None, BotIntent.BOOK, "es", None),
    _case("cn-1", "intents", "menu", MENU_Q, TEXT, "quiero cancelar la sesión del martes", None, BotIntent.CANCEL, "es", None),
    _case("cn-2", "intents", "menu", MENU_Q, TEXT, "cancelar", None, BotIntent.CANCEL, "es", None),
    _case("rs-1", "intents", "menu", MENU_Q, TEXT, "¿puedo cambiar la clase de Luis para el jueves?", None, BotIntent.RESCHEDULE, "es", None),
    _case("rs-2", "intents", "menu", MENU_Q, TEXT, "necesito mover la sesión a otro día", None, BotIntent.RESCHEDULE, "es", None),
    _case("cc-1", "intents", "menu", MENU_Q, TEXT, "gracias!", None, BotIntent.CHIT_CHAT, "es", None),
    _case("cc-2", "intents", "menu", MENU_Q, TEXT, "buenas tardes", None, BotIntent.CHIT_CHAT, "es", None),
    _case("qn-1", "intents", "menu", MENU_Q, TEXT, "¿cuánto cuesta una sesión?", None, BotIntent.QUESTION, "es", None),
    _case("st-1", "stop/start", "menu", MENU_Q, TEXT, "STOP", None, None, None, "stop"),
    _case("st-2", "stop/start", "menu", MENU_Q, TEXT, "para", None, None, "es", "stop"),
    _case("st-3", "stop/start", "menu", MENU_Q, TEXT, "ya no me escriban", None, None, "es", "stop"),
    _case("st-4", "stop/start", "menu", MENU_Q, TEXT, "no más recordatorios por favor", None, None, "es", "stop"),
    _case("st-5", "stop/start", "menu", MENU_Q, TEXT, "quiero recibirlos otra vez", None, None, "es", "start"),
    _case("st-6", "stop/start", "menu", MENU_Q, TEXT, "please stop sending me reminders", None, None, "en", "stop"),
    _case("st-7", "stop/start", "menu", MENU_Q, TEXT, "cancelar la sesión de mañana", None, BotIntent.CANCEL, "es", ""),
    _case("mx-1", "mixed", "menu", MENU_Q, TEXT, "quiero book una session para Ana el Tuesday", None, BotIntent.BOOK, "es", None),
    _case("mx-2", "mixed", "book_date", DATE_Q, DATE, "next martes", "2026-10-06", None, None, None),
    _case("mx-3", "mixed", "reminders", REMIND_Q, YES_NO, "yes por favor", "yes", None, None, None),
    _case("en-1", "english control", "menu", MENU_Q, TEXT, "I need to book a math session for Ana", None, BotIntent.BOOK, "en", None),
    _case("en-2", "english control", "book_date", DATE_Q, DATE, "next Tuesday", "2026-10-06", None, "en", None),
    _case("en-3", "english control", "reminders", REMIND_Q, YES_NO, "sure, sounds good", "yes", None, "en", None),
)
# fmt: on


def _normalized(value: str | None) -> str:
    return (value or "").strip().casefold()


def score(case: Case, parsed: ParsedIntent | None) -> tuple[bool, str]:
    """Whether the parse matches every scored column, and what differed when it does not."""
    if parsed is None:
        return False, "no parse"

    problems = []
    if case.answer is not None and _normalized(parsed.answer) != _normalized(case.answer):
        problems.append(f"answer={parsed.answer!r}")
    if case.intent is not None and parsed.intent is not case.intent:
        problems.append(f"intent={parsed.intent.value}")
    if case.language is not None and (parsed.language or "") != case.language:
        problems.append(f"language={parsed.language}")
    if case.reminders is not None and (parsed.reminders or "") != case.reminders:
        problems.append(f"reminders={parsed.reminders}")

    return not problems, "; ".join(problems)


def _parse(case: Case) -> ParsedIntent | None:
    try:
        parsed = parser_service.parse_intent(
            step=case.step,
            question=case.question,
            body=case.body,
            context={},
            answer_kind=case.answer_kind,
            today=TODAY,
        )
    except parser_service.ParseFailed:
        parsed = None

    return parsed


def _expected(case: Case) -> str:
    parts = (
        "" if case.answer is None else f"answer={case.answer or 'null'}",
        "" if case.intent is None else f"intent={case.intent.value}",
        "" if case.language is None else f"language={case.language}",
        "" if case.reminders is None else f"reminders={case.reminders or 'null'}",
    )

    return ", ".join(part for part in parts if part)


def _got(parsed: ParsedIntent | None) -> str:
    if parsed is None:
        return "-"

    return (
        f"intent={parsed.intent.value}, answer={parsed.answer!r}, "
        f"language={parsed.language}, reminders={parsed.reminders}"
    )


def _api_key() -> str | None:
    """The key from the environment, else from `api/.env` (the app's settings do not read it)."""
    env_file = API_DIR / ".env"
    if "ANTHROPIC_API_KEY" not in os.environ and env_file.exists():
        for line in env_file.read_text().splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() == "ANTHROPIC_API_KEY":
                os.environ["ANTHROPIC_API_KEY"] = value.strip().strip("\"'")

    return os.environ.get("ANTHROPIC_API_KEY") or None


def main() -> int:
    api_key = _api_key()
    if api_key is None:
        print("ANTHROPIC_API_KEY is not set (environment or api/.env).", file=sys.stderr)
        return EXIT_NO_KEY

    # The real prompt and output model, through a client with room to answer every case.
    parser_service._client = anthropic.Anthropic(
        api_key=api_key, timeout=EVAL_TIMEOUT_SECONDS, max_retries=EVAL_MAX_RETRIES
    )
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(_parse, CASES))

    rows = ["| Case | Group | Message | Expected | Result |", "| --- | --- | --- | --- | --- |"]
    passed = 0
    for case, parsed in zip(CASES, results, strict=True):
        is_pass, problems = score(case, parsed)
        passed += is_pass
        verdict = "PASS" if is_pass else f"FAIL: {problems}"
        rows.append(
            f"| {case.case_id} | {case.group} | {case.body} | {_expected(case)} | "
            f"{verdict} ({_got(parsed)}) |"
        )

    print(f"Model {parser_service.MODEL}, today = {TODAY}: {passed}/{len(CASES)} passed.\n")
    print("\n".join(rows))

    return 0 if passed == len(CASES) else EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
