Model claude-haiku-4-5, today = 2026-10-04. Current prompt: 38/41. Bilingual prompt: 39/41 (also scored on language and reminders).

| Group | Current | Bilingual | Cases |
| --- | --- | --- | --- |
| yes/no | 8 | 8 | 8 |
| dates | 4 | 4 | 5 |
| grade | 4 | 4 | 4 |
| names | 2 | 2 | 2 |
| intents | 8 | 9 | 9 |
| stop/start | 7 | 7 | 7 |
| mixed | 3 | 3 | 3 |
| english control | 2 | 2 | 3 |

| Case | Group | Message | Expected | Current prompt | Bilingual prompt |
| --- | --- | --- | --- | --- | --- |
| yn-1 | yes/no | sí | answer='yes', lang=es | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=es, rem=None) |
| yn-2 | yes/no | Si | answer='yes', lang=es | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=es, rem=None) |
| yn-3 | yes/no | claro que sí | answer='yes', lang=es | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=es, rem=None) |
| yn-4 | yes/no | no gracias | answer='no', lang=es | PASS (intent=chit_chat, answer='no') | PASS (intent=chit_chat, answer='no', lang=es, rem=None) |
| yn-5 | yes/no | ok | answer='yes' | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=None, rem=None) |
| yn-6 | yes/no | dale, está bien | answer='yes', lang=es | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=es, rem=None) |
| yn-7 | yes/no | no sé, tal vez | answer='', lang=es | PASS (intent=chit_chat, answer=None) | PASS (intent=chit_chat, answer=None, lang=es, rem=None) |
| yn-8 | yes/no | sí, resérvela por favor | answer='yes', lang=es | PASS (intent=book, answer='yes') | PASS (intent=book, answer='yes', lang=es, rem=None) |
| dt-1 | dates | mañana | answer='2026-10-05', lang=es | PASS (intent=book, answer='2026-10-05') | PASS (intent=book, answer='2026-10-05', lang=es, rem=None) |
| dt-2 | dates | el martes que viene | answer='2026-10-06', lang=es | FAIL: answer='2026-10-13' (intent=book, answer='2026-10-13') | FAIL: answer='2026-10-13' (intent=book, answer='2026-10-13', lang=es, rem=None) |
| dt-3 | dates | el 14 de octubre | answer='2026-10-14', lang=es | PASS (intent=book, answer='2026-10-14') | PASS (intent=book, answer='2026-10-14', lang=es, rem=None) |
| dt-4 | dates | pasado mañana | answer='2026-10-06', lang=es | PASS (intent=book, answer='2026-10-06') | PASS (intent=book, answer='2026-10-06', lang=es, rem=None) |
| dt-5 | dates | el viernes | answer='2026-10-09', lang=es | PASS (intent=book, answer='2026-10-09') | PASS (intent=book, answer='2026-10-09', lang=es, rem=None) |
| gr-1 | grade | quinto grado | answer='5', lang=es | PASS (intent=book, answer='5') | PASS (intent=book, answer='5', lang=es, rem=None) |
| gr-2 | grade | está en kínder | answer='0', lang=es | PASS (intent=book, answer='0') | PASS (intent=book, answer='0', lang=es, rem=None) |
| gr-3 | grade | 3ro | answer='3', lang=es | PASS (intent=question, answer='3') | PASS (intent=book, answer='3', lang=es, rem=None) |
| gr-4 | grade | décimo | answer='10', lang=es | PASS (intent=book, answer='10') | PASS (intent=book, answer='10', lang=es, rem=None) |
| nm-1 | names | Me llamo María José Hernández | answer='María José Hernández', lang=es | PASS (intent=chit_chat, answer='María José Hernández') | PASS (intent=chit_chat, answer='María José Hernández', lang=es, rem=None) |
| nm-2 | names | José Núñez | answer='José Núñez' | PASS (intent=unknown, answer='José Núñez') | PASS (intent=unknown, answer='José Núñez', lang=es, rem=None) |
| bk-1 | intents | quiero reservar una clase de matemáticas para Ana | intent=book, lang=es | PASS (intent=book, answer=None) | PASS (intent=book, answer=None, lang=es, rem=None) |
| bk-2 | intents | necesito agendar una sesión | intent=book, lang=es | PASS (intent=book, answer=None) | PASS (intent=book, answer='book', lang=es, rem=None) |
| cn-1 | intents | quiero cancelar la sesión del martes | intent=cancel, lang=es | PASS (intent=cancel, answer=None) | PASS (intent=cancel, answer='cancel one', lang=es, rem=None) |
| cn-2 | intents | cancelar | intent=cancel, lang=es | FAIL: intent=unknown (intent=unknown, answer=None) | PASS (intent=cancel, answer=None, lang=es, rem=None) |
| rs-1 | intents | ¿puedo cambiar la clase de Luis para el jueves? | intent=reschedule, lang=es | PASS (intent=reschedule, answer=None) | PASS (intent=reschedule, answer=None, lang=es, rem=None) |
| rs-2 | intents | necesito mover la sesión a otro día | intent=reschedule, lang=es | PASS (intent=reschedule, answer=None) | PASS (intent=reschedule, answer=None, lang=es, rem=None) |
| cc-1 | intents | gracias! | intent=chit_chat, lang=es | PASS (intent=chit_chat, answer=None) | PASS (intent=chit_chat, answer=None, lang=es, rem=None) |
| cc-2 | intents | buenas tardes | intent=chit_chat, lang=es | PASS (intent=chit_chat, answer=None) | PASS (intent=chit_chat, answer=None, lang=es, rem=None) |
| qn-1 | intents | ¿cuánto cuesta una sesión? | intent=question, lang=es | PASS (intent=question, answer=None) | PASS (intent=question, answer=None, lang=es, rem=None) |
| st-1 | stop/start | STOP | rem=stop | PASS (intent=unknown, answer=None) | PASS (intent=unknown, answer=None, lang=None, rem=stop) |
| st-2 | stop/start | para | lang=es, rem=stop | PASS (intent=unknown, answer=None) | PASS (intent=unknown, answer=None, lang=es, rem=stop) |
| st-3 | stop/start | ya no me escriban | lang=es, rem=stop | PASS (intent=unknown, answer=None) | PASS (intent=unknown, answer=None, lang=es, rem=stop) |
| st-4 | stop/start | no más recordatorios por favor | lang=es, rem=stop | PASS (intent=question, answer=None) | PASS (intent=chit_chat, answer=None, lang=es, rem=stop) |
| st-5 | stop/start | quiero recibirlos otra vez | lang=es, rem=start | PASS (intent=unknown, answer=None) | PASS (intent=chit_chat, answer=None, lang=es, rem=start) |
| st-6 | stop/start | please stop sending me reminders | lang=en, rem=stop | PASS (intent=question, answer=None) | PASS (intent=unknown, answer=None, lang=en, rem=stop) |
| st-7 | stop/start | cancelar la sesión de mañana | intent=cancel, lang=es, rem=null | PASS (intent=cancel, answer='2026-10-05') | PASS (intent=cancel, answer='2026-10-05', lang=es, rem=None) |
| mx-1 | mixed | quiero book una session para Ana el Tuesday | intent=book, lang=es | PASS (intent=book, answer='book') | PASS (intent=book, answer=None, lang=es, rem=None) |
| mx-2 | mixed | next martes | answer='2026-10-06' | PASS (intent=book, answer='2026-10-06') | PASS (intent=book, answer='2026-10-06', lang=es, rem=None) |
| mx-3 | mixed | yes por favor | answer='yes' | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=es, rem=start) |
| en-1 | english control | I need to book a math session for Ana | intent=book, lang=en | PASS (intent=book, answer='book') | PASS (intent=book, answer=None, lang=en, rem=None) |
| en-2 | english control | next Tuesday | answer='2026-10-06', lang=en | FAIL: answer='2026-10-13' (intent=book, answer='2026-10-13') | FAIL: answer='2026-10-13' (intent=book, answer='2026-10-13', lang=en, rem=None) |
| en-3 | english control | sure, sounds good | answer='yes', lang=en | PASS (intent=chit_chat, answer='yes') | PASS (intent=chit_chat, answer='yes', lang=en, rem=None) |
