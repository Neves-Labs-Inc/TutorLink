"""PROTOTYPE, throwaway: Spanish trial for the intent parser (map #102, ticket #104).

Runs one bilingual message set through the parser twice: the current English prompt, and a
bilingual prompt that also returns `language` and `reminders`. Prints a results table and writes
it to `.scratch/map-102/parser-trial-results.md`. Not imported by the app; never ship this.

Run from `api/`:  UV_NATIVE_TLS=1 uv run python prototypes/spanish_parser_trial.py
Needs ANTHROPIC_API_KEY in `api/.env` (read here; the app's Settings does not load .env files).
"""

import datetime
import os
import pathlib
import secrets
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

API_DIR = pathlib.Path(__file__).resolve().parents[1]
REPO_DIR = API_DIR.parent

for line in (API_DIR / ".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://prototype:prototype@localhost/prototype")
os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
sys.path.insert(0, str(API_DIR))

import anthropic  # noqa: E402

from app.schemas.bot import AnswerKind, BotIntent  # noqa: E402
from app.services import parser_service  # noqa: E402

TODAY = datetime.date(2026, 10, 4)  # a Sunday

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=30.0, max_retries=2)


class BilingualOutput(parser_service._ModelOutput):
    language: Literal["en", "es"] | None
    reminders: Literal["stop", "start"] | None


BILINGUAL_PROMPT = (
    parser_service.SYSTEM_PROMPT
    + """

The parent may write in English, Spanish, or a mix of both. Whatever language they use, \
`answer` and every field value follow the forms above exactly: a yes/no answer is always the \
English word `yes` or `no` ("sí", "claro", "dale", "de acuerdo" are `yes`; "no gracias", \
"ahora no" are `no`); dates are ISO, resolving Spanish words such as "mañana", "el martes que \
viene" or "el 14 de octubre"; numbers are digits ("quinto" is `5`, "kínder" or "kinder" is `0`); \
names stay exactly as written.

Also return:
- `language`: `es` when the message is clearly written in Spanish, `en` when clearly in \
English, and null when it is too short or neutral to tell (a bare name, number, date, "ok", \
"STOP", an emoji). For a mix, the language most of the words are in.
- `reminders`: `stop` when the parent asks to stop receiving the weekly reminders or messages \
from us in any words or language ("STOP", "para", "ya no me escriban", "no more reminders"), \
`start` when they ask to receive them again ("START", "quiero recibirlos otra vez"), \
otherwise null. Asking to cancel a session is not `stop`."""
)

MENU_Q = "I can book a session, cancel one, or move one to another time. What would you like to do?"
REMIND_Q = (
    "Ms Helping Hands can send you a weekly WhatsApp reminder to book your tutoring sessions. "
    "You can reply STOP at any time to end them. Is that OK?"
)
DATE_Q = 'Which day would you like? For example, "Tuesday" or "October 14".'
GRADE_Q = "What grade is Ana in? For example, Kindergarten, 3rd grade or 10th grade. (Kindergarten = 0)"
NAME_Q = "What is your full name?"
CONFIRM_Q = "To confirm: Tuesday, October 6, 4:00-5:00 PM: Math for Ana with Mr. Lee. Should I book it?"

# (id, group, step, question, kind, body, expected answer, expected intent, language, reminders)
# None in an expected column means "not scored".
CASES = [
    ("yn-1", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "sí", "yes", None, "es", None),
    ("yn-2", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "Si", "yes", None, "es", None),
    ("yn-3", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "claro que sí", "yes", None, "es", None),
    ("yn-4", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "no gracias", "no", None, "es", None),
    ("yn-5", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "ok", "yes", None, None, None),
    ("yn-6", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "dale, está bien", "yes", None, "es", None),
    ("yn-7", "yes/no", "reminders", REMIND_Q, AnswerKind.YES_NO, "no sé, tal vez", "", None, "es", None),
    ("yn-8", "yes/no", "book_confirm", CONFIRM_Q, AnswerKind.YES_NO, "sí, resérvela por favor", "yes", None, "es", None),
    ("dt-1", "dates", "book_date", DATE_Q, AnswerKind.DATE, "mañana", "2026-10-05", None, "es", None),
    ("dt-2", "dates", "book_date", DATE_Q, AnswerKind.DATE, "el martes que viene", "2026-10-06", None, "es", None),
    ("dt-3", "dates", "book_date", DATE_Q, AnswerKind.DATE, "el 14 de octubre", "2026-10-14", None, "es", None),
    ("dt-4", "dates", "book_date", DATE_Q, AnswerKind.DATE, "pasado mañana", "2026-10-06", None, "es", None),
    ("dt-5", "dates", "book_date", DATE_Q, AnswerKind.DATE, "el viernes", "2026-10-09", None, "es", None),
    ("gr-1", "grade", "child_grade", GRADE_Q, AnswerKind.NUMBER, "quinto grado", "5", None, "es", None),
    ("gr-2", "grade", "child_grade", GRADE_Q, AnswerKind.NUMBER, "está en kínder", "0", None, "es", None),
    ("gr-3", "grade", "child_grade", GRADE_Q, AnswerKind.NUMBER, "3ro", "3", None, "es", None),
    ("gr-4", "grade", "child_grade", GRADE_Q, AnswerKind.NUMBER, "décimo", "10", None, "es", None),
    ("nm-1", "names", "intake_name", NAME_Q, AnswerKind.TEXT, "Me llamo María José Hernández", "María José Hernández", None, "es", None),
    ("nm-2", "names", "intake_name", NAME_Q, AnswerKind.TEXT, "José Núñez", "José Núñez", None, None, None),
    ("bk-1", "intents", "menu", MENU_Q, AnswerKind.TEXT, "quiero reservar una clase de matemáticas para Ana", None, BotIntent.BOOK, "es", None),
    ("bk-2", "intents", "menu", MENU_Q, AnswerKind.TEXT, "necesito agendar una sesión", None, BotIntent.BOOK, "es", None),
    ("cn-1", "intents", "menu", MENU_Q, AnswerKind.TEXT, "quiero cancelar la sesión del martes", None, BotIntent.CANCEL, "es", None),
    ("cn-2", "intents", "menu", MENU_Q, AnswerKind.TEXT, "cancelar", None, BotIntent.CANCEL, "es", None),
    ("rs-1", "intents", "menu", MENU_Q, AnswerKind.TEXT, "¿puedo cambiar la clase de Luis para el jueves?", None, BotIntent.RESCHEDULE, "es", None),
    ("rs-2", "intents", "menu", MENU_Q, AnswerKind.TEXT, "necesito mover la sesión a otro día", None, BotIntent.RESCHEDULE, "es", None),
    ("cc-1", "intents", "menu", MENU_Q, AnswerKind.TEXT, "gracias!", None, BotIntent.CHIT_CHAT, "es", None),
    ("cc-2", "intents", "menu", MENU_Q, AnswerKind.TEXT, "buenas tardes", None, BotIntent.CHIT_CHAT, "es", None),
    ("qn-1", "intents", "menu", MENU_Q, AnswerKind.TEXT, "¿cuánto cuesta una sesión?", None, BotIntent.QUESTION, "es", None),
    ("st-1", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "STOP", None, None, None, "stop"),
    ("st-2", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "para", None, None, "es", "stop"),
    ("st-3", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "ya no me escriban", None, None, "es", "stop"),
    ("st-4", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "no más recordatorios por favor", None, None, "es", "stop"),
    ("st-5", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "quiero recibirlos otra vez", None, None, "es", "start"),
    ("st-6", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "please stop sending me reminders", None, None, "en", "stop"),
    ("st-7", "stop/start", "menu", MENU_Q, AnswerKind.TEXT, "cancelar la sesión de mañana", None, BotIntent.CANCEL, "es", ""),
    ("mx-1", "mixed", "menu", MENU_Q, AnswerKind.TEXT, "quiero book una session para Ana el Tuesday", None, BotIntent.BOOK, "es", None),
    ("mx-2", "mixed", "book_date", DATE_Q, AnswerKind.DATE, "next martes", "2026-10-06", None, None, None),
    ("mx-3", "mixed", "reminders", REMIND_Q, AnswerKind.YES_NO, "yes por favor", "yes", None, None, None),
    ("en-1", "english control", "menu", MENU_Q, AnswerKind.TEXT, "I need to book a math session for Ana", None, BotIntent.BOOK, "en", None),
    ("en-2", "english control", "book_date", DATE_Q, AnswerKind.DATE, "next Tuesday", "2026-10-06", None, "en", None),
    ("en-3", "english control", "reminders", REMIND_Q, AnswerKind.YES_NO, "sure, sounds good", "yes", None, "en", None),
]


def run(case, *, bilingual: bool):
    _, _, step, question, kind, body, *_ = case
    prompt = parser_service._build_prompt(
        step=step, question=question, body=body, context={}, answer_kind=kind, today=TODAY
    )
    response = client.messages.parse(
        model=parser_service.MODEL,
        max_tokens=parser_service.MAX_TOKENS,
        system=BILINGUAL_PROMPT if bilingual else parser_service.SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        output_format=BilingualOutput if bilingual else parser_service._ModelOutput,
    )
    return response.parsed_output


def _norm(value):
    return (value or "").strip().casefold()


def score(case, out, *, bilingual: bool) -> tuple[bool, str]:
    _, _, _, _, _, _, want_answer, want_intent, want_lang, want_rem = case
    if out is None:
        return False, "no parse"
    problems = []
    if want_answer is not None and _norm(out.answer) != _norm(want_answer):
        problems.append(f"answer={out.answer!r}")
    if want_intent is not None and out.intent is not want_intent:
        problems.append(f"intent={out.intent.value}")
    if bilingual:
        if want_lang is not None and out.language != want_lang:
            problems.append(f"lang={out.language}")
        if want_rem is not None and (out.reminders or "") != want_rem:
            problems.append(f"reminders={out.reminders}")
    return not problems, "; ".join(problems)


def describe(out, *, bilingual: bool) -> str:
    if out is None:
        return "-"
    parts = [f"intent={out.intent.value}", f"answer={out.answer!r}"]
    if bilingual:
        parts += [f"lang={out.language}", f"rem={out.reminders}"]
    return ", ".join(parts)


def main() -> None:
    with ThreadPoolExecutor(max_workers=6) as pool:
        current = list(pool.map(lambda c: run(c, bilingual=False), CASES))
        bilingual = list(pool.map(lambda c: run(c, bilingual=True), CASES))

    rows = [
        "| Case | Group | Message | Expected | Current prompt | Bilingual prompt |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    totals = {"current": 0, "bilingual": 0}
    by_group: dict[str, list[int]] = {}
    for case, cur, bil in zip(CASES, current, bilingual, strict=True):
        cid, group, *_ , body, want_answer, want_intent, want_lang, want_rem = case
        ok_c, why_c = score(case, cur, bilingual=False)
        ok_b, why_b = score(case, bil, bilingual=True)
        totals["current"] += ok_c
        totals["bilingual"] += ok_b
        g = by_group.setdefault(group, [0, 0, 0])
        g[0] += ok_c
        g[1] += ok_b
        g[2] += 1
        expected = ", ".join(
            x
            for x in (
                f"answer={want_answer!r}" if want_answer is not None else "",
                f"intent={want_intent.value}" if want_intent is not None else "",
                f"lang={want_lang}" if want_lang is not None else "",
                f"rem={want_rem or 'null'}" if want_rem is not None else "",
            )
            if x
        )
        rows.append(
            f"| {cid} | {group} | {body} | {expected} | "
            f"{'PASS' if ok_c else 'FAIL: ' + why_c} ({describe(cur, bilingual=False)}) | "
            f"{'PASS' if ok_b else 'FAIL: ' + why_b} ({describe(bil, bilingual=True)}) |"
        )

    summary = [
        f"Model {parser_service.MODEL}, today = {TODAY}. Current prompt: {totals['current']}/{len(CASES)}. "
        f"Bilingual prompt: {totals['bilingual']}/{len(CASES)} (also scored on language and reminders).",
        "",
        "| Group | Current | Bilingual | Cases |",
        "| --- | --- | --- | --- |",
        *(f"| {g} | {c} | {b} | {n} |" for g, (c, b, n) in by_group.items()),
        "",
    ]
    report = "\n".join(summary + rows) + "\n"
    out_path = REPO_DIR / ".scratch" / "map-102" / "parser-trial-results.md"
    out_path.write_text(report)
    print(report)
    print(f"written to {out_path}")


if __name__ == "__main__":
    main()
