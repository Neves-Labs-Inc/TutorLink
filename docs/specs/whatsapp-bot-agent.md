# Spec: WhatsApp bot agent

An LLM agent with tools replaces the WhatsApp bot's fixed-step state machine. It covers the whole conversation: Intake, booking, Reschedule, cancelling, reminder replies and off-script questions.

- **Source:** [Map: WhatsApp bot rework (#241)](https://github.com/Neves-Labs-Inc/TutorLink/issues/241) and the "Resolution" comment on each ticket it indexes. Each section names the tickets it comes from.
- **Vocabulary:** `CONTEXT.md`. Capitalised terms (Guardian, Intake, Intake in progress, Office handoff, Needs attention, Takeover, Hand-back, Assigned Tutors, Home, Location, Evaluated...) mean exactly what the glossary says.
- **Status:** every map ticket is closed. This spec says what to build and why; the planner slices it into build tickets.

## 1. Goal

The client asked for a bot that talks more like a person (meeting of 2026-10-15). Today's bot is a fixed sequence of steps in `bot_service.py`. It asks one question per message, rejects answers it can't parse, and gives up after two re-prompts. "Fluent" means all four of these (map Notes):

- **Free-form answers:** several fields in one message.
- **Fewer questions.**
- **Warmer wording.**
- **Coping with off-script turns and changes of mind.**

Typo and casing tolerance come with the agent and need no separate work.

### What changes for the Guardian

- They can answer in their own words, in any order, several things at once. The bot asks only for what's still missing.
- Intake asks fewer questions. Date of birth and Home label are no longer asked, and directions and Child notes are one closing question.
- An offer and "Should I book it?" come in one message, so "ok 4 is fine" books it. A change of mind before saying yes just changes the offer.
- Two Children can be booked with one yes.
- Anything the bot can't do goes to the office, and the bot says so. It keeps helping with everything else.
- Replies arrive a few seconds after the Guardian stops typing, with a typing indicator while the bot works, and as one reply per burst of messages.
- After Intake, they can add another Child or Home through the bot.

### What changes for the office

- Flag labels now follow their meaning. "Bot didn't understand" means the bot couldn't make sense of the Guardian. "Bot got stuck" means the bot itself failed and the Guardian was told the office will get back to them.
- One "Intake in progress" badge on the chat list row and the thread header. It covers new numbers whose Guardian isn't named yet, and named Guardians with no Home or no Child.
- A failed bot reply shows as failed, like a failed office reply, without Retry.
- Partly finished Intakes are saved as they go, so the Guardian exists on the dashboard as soon as they're named.
- The chat view otherwise looks the same. No tool calls, reasoning or proposal state are shown.

## 2. Agent

### Model and effort ([#251](https://github.com/Neves-Labs-Inc/TutorLink/issues/251), [#259](https://github.com/Neves-Labs-Inc/TutorLink/issues/259))

- **Default:** Sonnet 5.5 at `low` effort. One model for the whole conversation, not a mix.
- **Haiku 5.5** replaces it only if, before launch, its evaluation transcripts match Sonnet's (see section 10).
- **Tool use:** `tool_choice: auto`, `strict` tool schemas.
- **Prompt caching:** the tool definitions and system prompt (voice guide, rules, few-shot examples) form a cached prefix. Per-turn content (Guardian snapshot, history) comes after it.
- **Timeouts:** 10 to 15 s per model call with 1 retry, under the 60 s turn cap (section 7).
- **Write tools are idempotent**, so a retried call doesn't save twice.
- **Research:** estimated cost and latency are in [`docs/research/bot-agent-model.md`](https://github.com/Neves-Labs-Inc/TutorLink/blob/research/bot-agent-model/docs/research/bot-agent-model.md) (branch `research/bot-agent-model`). With caching, an Intake is about $0.04 on Sonnet, so cost doesn't decide the model.

### Where rules live ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252))

Business rules are enforced **inside the tools**, never only in the prompt. The prompt explains the rules only so the agent doesn't offer what it can't deliver. A refused call returns a reason, and the agent rephrases it for the Guardian.

**Guardian self-service policy (new module).** The tools call it before the shared Booking services (`booking_write_service`, `booking_status_service`). It holds the rules that apply to Guardians but not to the Office:

| Rule | Today |
|---|---|
| **Cancellation cutoff** (`cancellation_cutoff_hours`). The refusal reason carries the hours, so the agent can say "less than 24 hours away" ([#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258)) | Only inside the state machine |
| **Assigned Tutors at write time**: a Guardian can only book a Child's Assigned Tutors | Not checked on the write path |
| **Location mode** of the offered slot | Inside the state machine |
| **Per-Child overlap guard**: a Child can't hold two overlapping live Sessions | New. Today only Staff overlaps are blocked |

The Office keeps its freedoms: it can cancel inside the cutoff and book any Tutor with a warning.

These rules stay in the shared services, as today: Evaluated-only Tutoring, booking window and lead time, Availability, gap, Time off, the Guardian–Child link, and archived references.

### Tools ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252), [#253](https://github.com/Neves-Labs-Inc/TutorLink/issues/253), [#255](https://github.com/Neves-Labs-Inc/TutorLink/issues/255))

| Tool | Kind | Needs the Guardian's yes |
|---|---|---|
| Create / update Guardian, Home, Child (Intake and later additions) | write | no |
| List Subjects | read | - |
| List slots: Assigned Tutors only, filtered by Location | read | - |
| `propose`: one or more book / cancel / reschedule actions | write (pending only) | - |
| `commit_proposal` | write | yes, enforced in code |
| Set Booking reminder preference (opt in or out) | write | no |
| `hand_off_to_office(reason, summary)` | write | no |

- **Only lookups that take arguments are tools.** Everything else comes from the Guardian snapshot.
- **The office FAQ lookup listed in #252 is dropped.** [Bot agent: office FAQ (#254)](https://github.com/Neves-Labs-Inc/TutorLink/issues/254) is out of scope, so off-script questions go to the office (section 3).
- **No edit tools after Intake.** A request to change a saved address, name or phone is an Office handoff filed as Has a question (`question`).
- **Writes without a yes** run straight away, and the agent repeats back what it did.
- **The agent never sees raw errors.** An unexpected tool error (a bug or database error, not a rule refusal) ends the turn as an outage (section 6).

### Propose then commit ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252), [#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258))

Book, cancel and Reschedule need the Guardian's yes. Code enforces it in two phases:

1. **Propose.** `propose` stores **one pending proposal per conversation**, holding one or more actions (e.g. "book Ana and Leo Tuesday 4pm"), and returns its summary. A new proposal replaces the old one.
2. **Commit.** `commit_proposal` runs only if a **Guardian message arrived after the proposal was made**. It re-checks every rule (slot still free, cutoff, Assigned Tutor, `updated_at`) and runs all actions in **one savepoint**: if any fails, none land, and the reason goes back to the agent to explain.

- **Offer and ask together:** when one time fits, the agent proposes it and asks "Should I book it?" in the same message. There's no separate "To confirm" round.
- **Expiry:** a proposal is dropped after 30 idle minutes (checked at commit), when a new one replaces it, or on Hand-back (section 6).

### Guardian snapshot ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252))

Each turn, code puts a snapshot of the Guardian into the prompt after the cached prefix:

- Children, archived ones included, so the agent can spot a Reactivation request
- Each Child's Evaluated status and Assigned Tutors
- Homes
- Upcoming Tutoring Sessions
- Whether Intake is in progress, and what's missing

Identity stays the phone number, as today.

## 3. Conversation flows

### Intake ([#253](https://github.com/Neves-Labs-Inc/TutorLink/issues/253))

| Record | Required | Optional |
|---|---|---|
| Guardian | name | - |
| Home | address | directions, label |
| Child | name, school, Overall grade | notes, date of birth |

- **Saved as it goes.** The agent calls a record's create tool once that record's required fields are in. The Guardian exists once named. A Home or Child exists only once complete, so only the Guardian can be partial.
- **Intake is finished** at Guardian name + one Home + one Child with its required fields. Until then the Guardian and their chat are **Intake in progress** (section 8).
- **Any order, several fields per message.** The agent asks only for what's missing.
- **Already with us?** Asked **once, up front**, before the first Child: "Are any of your children already with us through another parent?" Yes is an Office handoff with the Link request reason (`guardian_link_request`), as today.
- **Date of birth:** not asked. Saved only if volunteered.
- **Home label:** not asked. The first Home is labelled with the Guardian's name (e.g. "Maria's").
- **Closing asks**, after the required fields. They don't hold Intake open:
  - One bundled question for directions and Child notes ("Anything the tutor should know: gate code, parking, allergies, learning needs?"). The agent splits the answer into Home directions and Child notes.
  - "Add another child?"
- **Intake close** ([#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258)): the first-Session news and the weekly reminder offer are **two separate messages**.

**Adding later.** After Intake, a Guardian can add another Child or Home through the same create tools (no yes needed). Changing a saved record still goes to the office.

- **New Child:** the "already with us?" check is asked again for that Child, then the bundled ask, scoped to notes.
- **New Home:** the agent asks for a label (it matters once there's more than one Home), then the bundled ask, scoped to directions.

**Early booking.** A Guardian who asks for a first Session before Intake is finished is told what's still needed. The agent finishes Intake, then hands the first-Session request to the office (`booking_request`).

### Booking, Reschedule and cancelling ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252), [#257](https://github.com/Neves-Labs-Inc/TutorLink/issues/257), [#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258))

- **Booking** is for Evaluated Children with their Assigned Tutors. The agent lists slots, proposes, and commits on the Guardian's yes.
- **No Assigned Tutor teaches the Subject:** an Office handoff. The agent says the office will find a Tutor and get back to them.
- **Assigned Tutors teach it but none is free:** the agent offers other days first, then hands off the same way.
- **New Subject for an Evaluated Child:** the bot only says the office will find a tutor. Staff explain any evaluation.
- **"Assigned Tutor" is never said to Guardians.**
- **Change of mind** before the yes: the agent proposes again, which replaces the pending proposal.
- **Cancel and Reschedule** go through the same propose → commit. Inside the cutoff, the agent refuses and states the hours.
- **After a commit:** code sends the fixed confirmation (section 4). The agent may follow with one short line: "Anything else?", or a question about Children the reminder named who are still unbooked that week. It must not repeat dates, times or Tutors.

### Reminder replies ([#256](https://github.com/Neves-Labs-Inc/TutorLink/issues/256), [#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258))

- The weekly Booking reminder stays a fixed, approved WhatsApp template sent by code.
- It enters the agent's history as a system note (section 5), so a reply like "yes tuesday for ana" has its context. The agent then books through the normal flow.
- STOP/START keywords (including BAJA/PARAR/ALTA) and the reminder's stop button stay handled in code with fixed replies, as today.
- The agent can also set the reminder preference with its tool, e.g. after the Intake close offer.

### Off-script and handoffs ([#252](https://github.com/Neves-Labs-Inc/TutorLink/issues/252), [#255](https://github.com/Neves-Labs-Inc/TutorLink/issues/255), map Notes)

- The agent handles everything the bot does today, **in any order**.
- Anything else is an Office handoff through `hand_off_to_office(reason, summary)` on today's reasons:

| Situation | Reason (value) |
|---|---|
| Question the bot can't answer, or a change to a saved record | Has a question (`question`) |
| First Session, no Assigned Tutor teaches it, or none free | Wants to book (`booking_request`) |
| Child already registered under another Guardian | Link request (`guardian_link_request`) |
| Archived Child to bring back | Reactivation request (`reactivation_request`) |
| Agent judges it's going in circles | Bot didn't understand (`didnt_understand`) |

- The summary carries the details for the office.
- After any handoff, the agent tells the Guardian the office will get back to them, and **keeps helping** with everything else until someone takes over (section 6).

## 4. Messages ([#257](https://github.com/Neves-Labs-Inc/TutorLink/issues/257), [#258](https://github.com/Neves-Labs-Inc/TutorLink/issues/258))

### Fixed vs agent-written

Facts are fixed; talk is free.

| Fixed templates, sent by code | Agent-written |
|---|---|
| Confirmation after each `commit_proposal` (book, cancel, Reschedule) | Every question |
| Takeover and Hand-back notices | Handoff acknowledgements |
| STOP/START opt-out and opt-in replies | Cutoff refusals |
| Booking reminder (the only approved WhatsApp template) | No-slots replies |
| Outage apology (section 6) | Everything else |

- **Where:** fixed templates live in `api/app/services/bot_messages.py`, in English and formal Spanish.
- **Deleted:** parser-era strings such as `BAILED_OUT`, `CANNOT_CONTINUE` and the re-prompts.

### Confirmation shape (signed off in #258)

One message per commit. A warm lead-in, then one line per Booking, built from the saved Bookings:

```
Your session is booked:            | Su sesión está reservada:
Both sessions are booked:          | Las dos sesiones están reservadas:

{date}, {time}: {Subject} for {Child} with {Tutor} {place}
```

Single and multi-action confirmations use the same shape. The lead-ins for cancel and Reschedule aren't written yet (open item 1 in section 12).

### Copy rules

- **Tutor name:** the full stored `User.name`, as today.
- **Home:** while a family has one Home, say "at home" / "en casa". Show the label only once there's a second Home. The stored label stays the Guardian's name for staff.
- **In office:** use the `office_address` setting (`settings_service.py`), the same text in both languages. Fall back to "at the office" / "en la oficina" when blank.
- **Business name:** **M's Helping Hands** (brand doc). Fixed strings spelling it "Ms Helping Hands" are respelled.

### Tone

- Warm, brief, no emoji. Formal "usted" in Spanish, matching today's reviewed copy.
- The cached system prompt teaches it with a short voice guide plus reviewed examples in both languages.
- **Few-shot examples:** the six reviewed sample chats on branch [`prototype/bot-sample-conversations`](https://github.com/Neves-Labs-Inc/TutorLink/tree/prototype/bot-sample-conversations) (`api/prototypes/bot-sample-conversations.html`), with the #258 changes applied. Scenarios: Intake in one go, booking with a change of mind, off-script question with Takeover and Hand-back, typo-laden reminder reply, no tutor / none free, two Children with one yes.

### Language

- The agent replies in the language of the Guardian's latest message, and returns that language with its reply each turn.
- Code overwrites `conversations.language` with it and uses it for fixed messages.
- BAJA/PARAR/ALTA keywords and the staff language override stay.

## 5. Memory and redaction ([#256](https://github.com/Neves-Labs-Inc/TutorLink/issues/256))

### History

- **Rebuilt each turn from `messages`.** No separate agent transcript, no summaries, and tool calls from earlier turns are not replayed. Durable facts come from the snapshot.
- **Window:** the last 20 messages.
- **Chat turns:** Guardian, bot and office messages.
- **Bracketed notes:** system notices (Takeover, Hand-back, Booking reminders, office booking notices), so a reply to a reminder or to staff has its context.
- **Times:** each line carries its time, with a **gap marker** wherever more than a few hours passed. After a gap, the agent answers what was asked, and if Intake is unfinished it briefly says what's still needed.
- **Retention:** the nightly retention purge only shrinks what's available.

### What replaces the flow state

- `bot_flow_state` and its 30-minute TTL (`bot_state.py`) are removed.
- Only the pending proposal expires.
- Everything else lives in saved records and the history window.

### Redaction (keeps P7-F / A-55)

Address, directions, date of birth and notes reach the model when typed, but appear as placeholders in history once saved.

- **Matching.** A message holds a value when the value appears in its body once both are normalised: lowercased, every run of characters that aren't letters or digits (spaces, line breaks, punctuation) collapsed to one space, trimmed. The value must match whole words: "12 Oak St\nApt 4" holds the saved "12 Oak St, Apt 4", but "address" doesn't hold the notes "ADD", and "12 Oak Street" doesn't hold "12 Oak St". A blank value never matches. One helper (`bot_redaction`) does this for marking and for history.
- **Marking.** When `create_home`, `create_child`, `update_home` or `update_child` stores one of these fields, the candidates are the Guardian messages and bot replies since that record's last save (for a new record, the last 20, which covers any history window). Each field marks only the candidates holding its saved value. A date of birth matches as the tool received it and as the ISO date.
- **Fallback.** When no candidate holds the value (the model reworded it, typical for directions and notes), the Guardian messages this turn answers (those since the last bot reply) are marked with the field instead.
- The agent may echo a value to confirm it ("Saved 12 Oak Street"). Each paragraph of the reply is marked with a field only if it holds that field's value.
- **History.** For a marked message, the history collects the owning Guardian's saved values per marked field: every Home's address and directions and every linked Child's notes, archived records included. When every marked field has a value found in the body, the message shows as usual with each found value replaced inline, e.g. `Guardian: Jane Doe\nAddress: [the Home address: saved]\nSchool: Lincoln`. Overlapping matches merge into one placeholder. Otherwise (a date of birth, which is never matched here, a reworded value, or one the office changed since) the whole message shows as a placeholder, e.g. `[Guardian gave the Home address: saved]`.
- Bodies are never changed, and messages marked before these rules are not re-marked.
- A value typed but **never saved** stays verbatim until it leaves the 20-message window.
- Redaction is for the model only. The office sees full text (section 9).

## 6. Handoff and failure ([#255](https://github.com/Neves-Labs-Inc/TutorLink/issues/255))

### Bot didn't understand (confusion)

- The agent hands off with `didnt_understand` when it judges it's going in circles.
- **No-progress cap (replaces `MAX_REPROMPTS`):** code also flags after **4 Guardian messages in a row with no progress**. Progress is a successful save, proposal, commit or handoff; read-only lookups don't count.
- The count resets only on progress, never on silence. The cap fires when it reaches exactly 4, so once per stretch.
- After the flag, the agent tells the Guardian the office has been asked to help, and keeps going.

### Bot got stuck (failures)

Each of these flags the chat "Bot got stuck" (`stuck`):

| Failure | What happens |
|---|---|
| **Model outage**: timeout or error after the retry | Turn rolls back. Fixed apology, in the Guardian's language |
| **Unexpected tool error**: a bug or database error, not a rule refusal | Same as an outage |
| **Turn past the 60 s cap** | Same as an outage |
| **Send rejected or timed out** after one retry | Reply recorded as failed. Saves made in the turn stay |
| **Status callback reports failed/undelivered** for a bot reply (decided with Franklin while writing this spec) | Reply marked failed. No resend, since a late resend could land after the chat moved on |

- **Outage apology:** sent **once per outage stretch**. Later failed turns get no reply until a model call succeeds, which ends the stretch.

### Flags

- The flag only marks the chat Needs attention. **The agent keeps helping** with everything else until someone takes over.
- **Latest reason wins**, as today. A pending Reactivation request is kept until settled.
- **Labels follow the meaning**, swapping today's mapping:

| Meaning | Value | Label |
|---|---|---|
| Confusion | `didnt_understand` | Bot didn't understand |
| Failure | `stuck` | Bot got stuck |

### Takeover and Hand-back

- The agent is silent while a chat is Taken over.
- **On Hand-back**, the agent reads the office's messages as part of history, and any **pending proposal is dropped**, so a yes typed to staff never commits a Booking.
- **Race:** just before sending, code checks for a Takeover and drops the unsent reply if one started. Saves already made in that turn stay, and the office sees them.

## 7. Asynchronous replies ([#256](https://github.com/Neves-Labs-Inc/TutorLink/issues/256), [#260](https://github.com/Neves-Labs-Inc/TutorLink/issues/260))

An agent turn makes several model calls in a row and doesn't reliably fit Twilio's 15 s webhook limit. So the bot answers asynchronously, and replies leave through Twilio's send API instead of inline TwiML.

### Webhook

1. Check the signature (unchanged).
2. Record the inbound message. Duplicates are still dropped by `UNIQUE (messages.twilio_sid)`.
3. Stamp the chat's **turn due = now + 4 s**. Each new message pushes it forward (the debounce).
4. Return an empty 200.

### Worker

- **Where:** a loop inside the API process, started from the lifespan in `api/app/main.py` like the retention, reminder and reply-window schedulers. No Redis, queue or extra container.
- **What it runs:** it picks chats whose turn is due and runs each under a **per-chat Postgres advisory lock**, so only one turn runs per chat even across processes.
- **One turn per burst:** everything that arrived goes into one turn and gets one reply.
- **Mid-turn messages** only move the marker. The next turn runs after the current one has committed and sent, and sees that reply in its history.

### Transaction and crashes

- A turn is **one transaction**. The turn-due marker clears only when it commits.
- A turn killed mid-run (crash or deploy) leaves nothing saved, and the worker runs it again after restart. The Guardian gets a late reply instead of none.

### Typing indicator

- Shown **when the turn starts**, not during the debounce, against the latest inbound message.
- Renewed about every 20 s (one lasts 25 s) until the reply goes out.

### Limits and retries

- **Turn cap:** 60 s. Past that, the turn counts as an outage (section 6).
- **Send failure:** retry once after a few seconds, then record it failed and flag "Bot got stuck" (section 6).
- Bot replies now get a `twilio_sid` and move `queued` → `sent` → `delivered`/`failed` through the status callback, like office replies.

## 8. Data changes and migration ([#261](https://github.com/Neves-Labs-Inc/TutorLink/issues/261))

### `conversations` gains the bot's runtime state

No new table.

| Column | Shape | Notes |
|---|---|---|
| `proposal_actions` | JSONB NULL | One or more actions |
| `proposed_at` | timestamptz NULL | CHECK: both NULL or both set with `proposal_actions`. Dropping a proposal sets both NULL. Expiry is checked at commit. "Guardian message after the proposal" is compared against `messages` |
| `no_progress_count` | int NOT NULL DEFAULT 0 | Reset only on progress. Cap fires at exactly 4 |
| `outage_apology_sent_at` | timestamptz NULL | Set when the apology goes out; cleared on the next successful turn |
| `turn_due_at` | timestamptz NULL | Partial index `WHERE turn_due_at IS NOT NULL` for the worker's poll. Cleared when the turn commits |

### `messages` gains `redacted_fields`

- **Shape:** text[] NULL, e.g. `{home_address, home_directions, child_date_of_birth, child_notes}`.
- **History** builds the placeholders from it (section 5).
- **The body is kept**, so the office's record stays intact.

### Derived or existing, no new storage

- **Intake in progress:** derived as a Guardian with no Home or no Child, or a chat with no Guardian yet. The API sends it as a field on the conversation (section 9).
- **Guardian language:** the existing `conversations.language`.
- **Failed reply:** the existing `messages.status` (`queued` → `failed`).
- **Tool audit:** none in the database. Each tool call and result goes to the structured app log with the conversation id.

### Flag values

- `FlagReason.PARSE_ERROR` is retired, and a `didnt_understand` value is added.
- The migration remaps existing rows in order: `stuck` → `didnt_understand`, then `parse_error` → `stuck`.
- Both `flag_reason` and `handled_flag_reason` are remapped.
- The dashboard label map (`dashboard/src/pages/prototype/home/lib/labels.ts`) follows.

### Migration (pre-launch)

- Drop `bot_flow_state` outright. A mid-flow chat carries on with the agent from history.
- New columns start NULL / 0.
- No redaction backfill on existing messages.

### Removed code

| Removed | Replaced by |
|---|---|
| State machine (`api/app/services/bot_service.py`: steps, handlers, re-prompts) | The agent loop, tools and Guardian self-service policy |
| `api/app/services/bot_state.py` and the `BotFlowState` model | The proposal columns and history |
| Parser (`api/app/services/parser_service.py`, `api/scripts/parser_eval.py`, its tests) | The agent; the eval harness (section 10) |
| Inline TwiML bot replies in `webhook_service.py` | Turn-due marker, worker and send API |
| Parser-era strings in `bot_messages.py` | Agent-written text |

Tests that exercise the state machine (`test_bot_service.py`, `test_bot_intake.py`, `test_bot_parser_contract.py`, `test_bot_state.py`, `test_parser_*.py` and parts of others) go with it. Tests of keyword, consent and reminder behaviour that survives are rewritten against the new seams.

## 9. Dashboard chat view ([#262](https://github.com/Neves-Labs-Inc/TutorLink/issues/262))

The chat view stays a chat view.

### Not shown

- **Tool calls and reasoning:** these stay in the app log.
- **Pending proposal:** the bot's offer message is enough for someone taking over.
- **Redaction placeholders:** the office sees full message text. Saved fields are on the Guardian and Child pages anyway.

### New

- **"Intake in progress" badge** on the conversation list row and the thread header. It replaces the prototype's "New number · in Intake" badge. One badge covers both a new number whose Guardian isn't named yet and a named Guardian with no Home or no Child. The API sends it as a field on the conversation.
- **Failed bot replies** use the same "failed" styling as office replies, **without Retry**. The office takes over or marks the chat done.
- **Flag labels** follow the renamed values (section 6).

### Roles

Admins and Managers see the same view. Tutors never see chats.

## 10. Evaluation and rollout ([#259](https://github.com/Neves-Labs-Inc/TutorLink/issues/259), [#251](https://github.com/Neves-Labs-Inc/TutorLink/issues/251))

### Evaluation harness (hand-run, not in CI)

- **What it is:** a script in the spirit of `api/scripts/parser_eval.py`. A second model plays the Guardian from a persona and a goal, against the real agent and tools.
- **Setup:** a seeded throwaway database, Twilio faked, and the debounce skipped.
- **Output:** each transcript, plus what got saved (Guardian, Homes, Children, Bookings, handoff reason).
- **Scoring:** none automatic. Franklin reads the transcripts.
- **Models:** every persona runs on **both Haiku 5.5 and Sonnet 5.5**, logging latency, tokens and cost per turn. This is the measured run #251 was held open for.

**Personas**, each in English and Spanish:

1. **New Guardian Intake:** several fields in one message, finishes Intake with one Child.
2. **Booking with a change of mind:** an Evaluated Child; changes the day before saying yes, then does a Reschedule.
3. **Off-script plus no Tutor:** asks something outside the bot's scope, and asks for a Subject no Assigned Tutor covers. Both should hand off.
4. **Typos, curt, confused:** typo-heavy, one-word replies, goes quiet, then resumes after a gap.

**When it runs**

- **Sign-off:** Franklin reads every persona in both languages on the chosen model before launch.
- **Re-runs:** by hand, before merging any change to the system prompt, the model or the tool definitions. No scheduled runs.

### CI (no model calls)

- **Tools and policy:** unit tests for every tool and the Guardian self-service policy module.
- **Agent loop:** tests with a fake model that emits set tool calls. They cover propose → commit, debounce, the no-progress cap, placeholders and the Takeover drop.

### Rollout

TutorLink is pre-launch, so the agent **replaces the state machine and parser outright**, in the same change. No flag and no fallback.

## 11. Out of scope (from the map)

- **Child profile** ("store parents and homes inside the child's profile"): the client meant showing Guardians and Homes on the Child's dashboard page, which the dashboard redesign already covers. Not a bot change.
- **Office FAQ** ([#254](https://github.com/Neves-Labs-Inc/TutorLink/issues/254)): no FAQ in this rework. Off-script questions go to the office as Has a question. Adding one later is a small, separate change.
- **Already fixed in today's bot, not held for the rework:** casing and typo rejects ([#236](https://github.com/Neves-Labs-Inc/TutorLink/issues/236)) and the Guardian's Home address question ([#237](https://github.com/Neves-Labs-Inc/TutorLink/issues/237)).
- **Edits after Intake through the bot:** they stay Office handoffs.

## 12. Open items for Franklin's sign-off

Franklin approves the changed fixed copy (no client review), in English and Spanish:

1. **Confirmations:** single and multi-action, plus the cancel and Reschedule versions, in the #258 shape.
2. **In office place:** the wording around the `office_address` setting and its blank fallback.
3. **Respelled business name:** "M's Helping Hands" in every fixed string that names it.
4. **Outage apology:** new fixed text.

## Glossary changes in this PR

`CONTEXT.md`, from the map sessions:

- **Intake:** gains the finish line, the optional fields, later additions, save-as-you-go, and **Intake in progress** (including chats from unnamed new numbers).
- **Location:** gains the Home label and its Intake default.
- **Needs attention:** gains the swapped meanings of Bot didn't understand and Bot got stuck, latest-reason-wins, and that the bot keeps helping while flagged.
