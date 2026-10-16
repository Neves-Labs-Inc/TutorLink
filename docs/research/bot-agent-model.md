# Bot agent: model, latency and cost per conversation

Research for ticket #251 (map #241). Read on 2026-10-16.

**Method.** Anthropic facts come from the live docs at platform.claude.com and the model announcement pages on anthropic.com, fetched today. Twilio facts come from twilio.com docs. Each claim is tagged **Documented** (a source says it) or **Inference** (ours). Token counts are **estimates**: no API key was available in this session, so nothing was measured against the live models. The last section says how to measure.

## Answer in short

- **Cost does not decide this.** A typical Intake costs about **$0.003 on Haiku 5.5 and $0.04 on Sonnet 5.5** with prompt caching. A typical booking costs about **$0.002 and $0.035**. Even 1,000 conversations a month on Sonnet 5.5 is about $40.
- **Latency does not fit today's webhook shape on either model.** An agent turn that calls a tool makes 2 or 3 model calls in a row. That does not fit reliably inside Twilio's 15 s webhook limit, which also has to cover the database work. Reply asynchronously: return an empty 200 to Twilio, show a WhatsApp typing indicator, run the agent, and send the reply through the Messages API.
- **Tool-use reliability decides it.** Anthropic positions Haiku 5.5 for "narrowly scoped" work. Its own prompting guide lists the failure modes an agent that books sessions would hit (skipped tool calls, early stopping, reasoning in the visible reply at low effort). Sonnet 5.5 is positioned for agentic tool use. A wrong booking costs much more than a few cents.
- **Recommendation:** run the agent on **Sonnet 5.5 at `low` effort**, as one model and not a mix. Cache the system prompt and tools. Build an English and Spanish conversation eval before launch, run it on both models, and move to Haiku 5.5 only if it matches Sonnet on that eval. Details at the end.

## 1. Models and prices

| | Claude Haiku 5.5 | Claude Sonnet 5.5 |
|---|---|---|
| API ID | `claude-haiku-5-5` | `claude-sonnet-5-5` |
| Positioning (Documented) | "high-volume, latency-sensitive tasks such as classification, extraction, and routing" | "The best combination of speed and intelligence" |
| Comparative latency (Documented) | Fastest | Fast |
| Input / output per MTok | $0.10 / $0.50 (prompts of 100K tokens or fewer) | $2 / $10 |
| 5 min cache write / 1 h cache write | $0.125 / $0.20 | $2.50 / $4 |
| Cache read | $0.01 | $0.10 |
| Minimum cacheable prefix | 512 tokens | 512 tokens |
| Default effort | `medium` | `high` |
| Tool-use system prompt overhead (`auto`) | 286 tokens | 286 tokens |
| Forced `tool_choice` (`any` / `tool`) | Accepted (406-token overhead), but the response then has no thinking | **400 error**; use `auto` plus `strict: true` |
| Server-side refusal fallback | None | `fallbacks: "default"` (Claude API only) |

Sources: [models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Haiku 5.5 page](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Sonnet 5.5 page](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Haiku 5.5 migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide), [Sonnet 5.5 what's new](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5).

- **Documented:** Haiku 5.5 has a second price card for prompts over 100,000 tokens ($0.50 / $2.50). A WhatsApp conversation stays far below that ([pricing, long context](https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing)).
- **Documented:** the pricing page lists the Sonnet 5.5 cache read at $0.10 (0.05x of input). Anthropic's bundled SDK migration notes say $0.20. The pricing page is the source used here.
- **Documented:** "US-only inference through the `inference_geo` parameter incurs a 1.1x multiplier" (pricing). Global routing, the default, uses standard prices.

## 2. Tokens and cost per conversation

### Assumptions (Inference)

- **Static prefix of about 4,300 tokens:** the tool-use system prompt (286) plus about 10 tool definitions at roughly 150 tokens each (create Guardian, Home and Child; list slots; book; cancel; reschedule; handoff; FAQ lookup; set reminders), about 1,800 in total, plus a system prompt of about 2,500 tokens (role, rules, English and Spanish guidance, booking policy). The date and the Guardian's own record go **after** the cache breakpoint.
- **Per-Guardian context:** about 300 tokens for a new number and about 700 for a returning Guardian (Children, Homes, upcoming Bookings).
- **Per request:** a Guardian message adds about 40 tokens, a tool result about 120, and a slot list about 400. Output is about 160 tokens per request: a reply or tool call of about 80, plus about 80 of thinking at `low` effort.
- **Intake (one Guardian, one Child):** today's state machine asks about 13 questions (`bot_service.py` steps `intake_name` to `reminders_opt_in`). An agent can ask for several at once. Assumed: **8 Guardian messages and 4 tool calls** (create Guardian, create Home, create Child, set reminders), so **12 model requests**.
- **Booking (returning Guardian):** **5 Guardian messages and 3 tool calls** (list slots twice, book once), so **8 model requests**.
- **Caching:** automatic caching (a top-level `cache_control`) on the 5-minute TTL. The worst case is assumed: the prefix is cold at the start of every conversation, so it is written once per conversation and read afterwards. This holds while the Guardian replies within 5 minutes of the last request. A cache read refreshes the timer ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Both models are assumed to use the same token counts. Haiku 5.5 uses the tokenizer introduced with Opus 4.7, about 30% more tokens than Haiku 4.5 (Documented, Haiku 5.5 page). The parser's existing token numbers do not carry over.

### Result

| Conversation | Requests | Input tokens (sum) | Output tokens | Haiku 5.5, no cache | Haiku 5.5, cached | Sonnet 5.5, no cache | Sonnet 5.5, cached |
|---|---|---|---|---|---|---|---|
| Intake (1 Guardian, 1 Child) | 12 | ~70,400 | ~1,900 | $0.008 | **$0.003** | $0.160 | **$0.043** |
| Booking | 8 | ~49,700 | ~1,300 | $0.006 | **$0.002** | $0.112 | **$0.035** |
| Mix: Haiku for Intake, Sonnet for booking | | | | | $0.003 + $0.035 | | |

- **Inference:** input is about 97% of the tokens, because every request resends the whole prefix and history. That is why caching cuts Sonnet's cost by about 70%. Output is a small share of the cost.
- **Inference, sensitivity:** double the turns or double the thinking (re-prompts, a Guardian who changes their mind) and the cached costs still stay under about $0.10 per conversation on Sonnet.
- **Inference:** when traffic keeps the shared static prefix warm across conversations (requests sharing it start less than 5 minutes apart), the per-conversation prefix write (about $0.011 on Sonnet) becomes a read. At TutorLink's volume, expect it to be cold most of the time. A 1-hour TTL pays off only when the same prefix is reused in the 5 to 60 minute gaps.
- **Inference, scale:** 1,000 cached conversations a month cost about $40 on Sonnet 5.5 and about $3 on Haiku 5.5. Twilio's WhatsApp fees and the time staff spend on a wrong Booking cost more than this difference.

### Caching rules that matter for this design (Documented)

- "Modifying tool definitions (names, descriptions, parameters) invalidates the entire cache." Keep the tool list identical on every request. Do not add or remove tools per flow.
- "Cache hits require 100% identical prompt segments." Do not put today's date or the Guardian's record in the cached system prompt. Put them in the first user turn, or in a mid-conversation system message.
- Changing the thinking configuration "always invalidates message blocks." Changing top-level `effort` between requests also invalidates the messages cache (Haiku 5.5 prompting guide). Pick one effort level per conversation.
- On Haiku 5.5, "thinking blocks are preserved by default, so the cache remains valid" across turns.
- **Documented in Anthropic's SDK guidance, not on the caching page:** caches are model-scoped. A mix that switches models mid-conversation rebuilds the cache on the second model.

## 3. Latency per turn against WhatsApp expectations

### The limits we work under

- **Documented, Twilio webhook:** connect timeout 5,000 ms, read timeout 15,000 ms, total 15,000 ms "for all timeouts including retries", 1 retry, and by default it retries only on connection failure ([Twilio webhook connection overrides](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides)). Today's webhook replies with TwiML inside that window (`api/app/routers/webhook.py:90`), and the parser was given 4 s × 2 attempts to fit (`parser_service.py:84-95`).
- **Documented, WhatsApp typing indicator (Twilio, Public Beta):** a POST to the v3 Typing Indicators endpoint with the inbound message SID. It marks the message as read, shows "typing…", and clears when the reply arrives or after 25 seconds. It can be re-sent to extend it ([Twilio typing indicators](https://www.twilio.com/docs/whatsapp/api/typing-indicators-resource)).
- **Not documented:** neither Meta nor Twilio states a reply-time expectation for a WhatsApp bot. **Inference:** people expect replies in seconds, not instantly. A typing indicator that appears at once and a reply within about 10 s reads as normal chat. A wait over 25 s without a renewed indicator reads as broken.

### Per-model latency

- **Documented:** Haiku 5.5 is "Fastest" and Sonnet 5.5 is "Fast" in the current lineup. "Actual latency depends on prompt length, output length, and thinking effort" (models overview). Anthropic publishes **no tokens-per-second or time-to-first-token figures** for either model. The announcements make only relative claims: Haiku 5.5 is "our fastest model to date at each model's standard speed", and a customer reports "up to 2.5x faster inference per agent turn". Sonnet 5.5 "generates outputs 30%+ faster than Sonnet 5" ([Haiku 5.5 announcement](https://www.anthropic.com/claude-haiku-5-5), [Sonnet 5.5 announcement](https://www.anthropic.com/claude-sonnet-5-5)).
- **Documented:** effort is the main speed lever. `low` is "the cheapest and fastest level. Use it for chat, short tool tasks" ([reduce latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency), [prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)). For Sonnet 5.5, Anthropic's guidance is to start at `low` for chat. `between_tools` is its lowest thinking setting; `disabled` returns a 400.
- **Documented:** caching gives "improved time-to-first-token for long documents."

**Estimate per Guardian turn (Inference, unmeasured; verify before relying on it):**

| Turn shape | Model calls in sequence | Haiku 5.5 `low` | Sonnet 5.5 `low` |
|---|---|---|---|
| Plain reply (a question or confirmation) | 1 | ~1–2 s | ~2–4 s |
| Reply after one tool (create Child, book) | 2 + DB time | ~2–4 s | ~4–8 s |
| Reply after two tools (list slots, then a second lookup) | 3 + DB time | ~3–6 s | ~6–12 s |
| One timeout plus retry in the path | +1 timeout | +timeout | +timeout |

The ranges assume about 5 to 7K input tokens, mostly cached, and about 160 output tokens per call. These are judgment calls, not measurements. The comment in `parser_service.py` saying Haiku "answers in under two seconds" is an earlier claim for a single extraction call and has not been measured either.

**Inference, consequence:** a two- or three-call turn on Sonnet can run past 15 s at its tail, and a single timeout plus retry pushes either model past it. **The agent must not run inside the TwiML response.** The webhook should:

1. Verify the signature, de-duplicate on `MessageSid`, and store the inbound message.
2. Return an empty 200 at once.
3. Hand the turn to a background worker. The worker sends the typing indicator, runs the agent loop, sends the reply through the Messages REST API (free-form, inside the 24-hour window), and re-sends the indicator if the turn passes about 20 s.

This change is needed whichever model is chosen, so the model choice no longer has to fit a 15 s budget.

## 4. Tool-use reliability (English and Spanish)

- **Documented, Haiku 5.5:**
  - Positioned for "more narrowly scoped tasks"; "Sonnet 5.5 and Opus 5.5 remain better choices for complex agentic coding tasks" (announcement). It is also said to work "especially well for speed-sensitive tasks like live customer support". HubSpot reported 92.8% on its CRM agent suite.
  - Its prompting guide names failure modes that apply here:
    - at `low` effort, "In long agent prompts, the model is more likely to skip a search, stop early, or skip a check";
    - with thinking off and a JSON output format, it "might skip a tool call it needs";
    - with thinking off or at `low`, it "sometimes writes reasoning-like text in the reply that users see", and the fix is adaptive thinking at `medium`.
  - The fix for the last one moves Haiku to `medium` effort, which costs latency.
- **Documented, Sonnet 5.5:**
  - A customer saw "the fewest failed tool calls of any model we compared". Zendesk: "made fewer wrong decisions and resolved tickets faster" (announcement).
  - Caveat from the migration guide: in chat, the model "can hold off on tools until asked directly". Do not tell it to minimise tool use, and say in the prompt when each tool applies.
  - Forced `tool_choice` returns a 400, so check that a call happened when one was expected.
- **Documented, both:**
  - `strict: true` on a tool guarantees schema-valid inputs.
  - Parallel tool calls are on by default; return every `tool_result` in one user message.
  - Both run safety classifiers that can return `stop_reason: "refusal"` (Haiku: no server-side fallback). Check `stop_reason` before reading content.
  - Both run the preserved-thinking history check. On accounts created on or after 2026-08-31, a request that sends back a thinking block after `system`, `tools` or earlier messages changed returns a 400. **The stored conversation must be append-only.** Today the parser rebuilds its context every call, so this is a real design change.
- **Not documented:** neither model has published English vs Spanish tool-use figures, and there are no public τ-bench-style numbers for either. The repo's own Spanish trial (#104) measured Haiku 5.5 on **single-message extraction**, not on multi-turn tool use. #27 measured Haiku 4.5 as the weakest candidate on free text such as "the tuesday one but later if she can", and the `parser_service.py` docstring says that warning still stands for Haiku 5.5.
- **Inference:** the agent decides *which* Child, slot and Booking to act on. That is exactly where #27 saw the cheapest model fail. With no measured evidence for Haiku 5.5 at this task, Sonnet 5.5 is the lower-risk default.

## 5. Timeouts and retries

Today's numbers (4 s, 1 retry) were chosen to fit Twilio's synchronous budget. Once the reply is asynchronous (§3), the budget becomes "about 25 s before the typing indicator lapses, renewable". Proposed (Inference):

- **Per model call:** `timeout` of 10 s on Haiku and 15 s on Sonnet, `max_retries=1`. The SDK retries 408, 409, 429, 5xx and connection errors, and timeouts are retried too, so the worst case per call is timeout × 2. Keep these as module constants, for the reason the parser's docstring gives.
- **Per Guardian turn:** a hard cap of about 45 s on the agent loop and at most 6 model calls. Past either cap, stop and send a fixed "Sorry, something went wrong, the office will follow up" message in the Guardian's language, then flag for the office (today's `parse_error` path).
- **`max_tokens`:** about 2,048. Thinking counts toward it on both models (Documented), so the parser's 256 would cut replies off.
- **Write tools are idempotent.** `book`, `cancel` and `reschedule` take an idempotency key, the `tool_use` id. A model call retried after a timeout must not create a second Booking.
- **Refusal or empty reply:** treat as a failure, as above. On Sonnet 5.5, `fallbacks: "default"` covers only `cyber` and `frontier_llm` declines.
- **Twilio redelivery:** de-duplicate on `MessageSid` before queueing. Twilio by default retries only on connection failure, but the redelivery the parser docstring describes must not run the agent twice.

## 6. A mix?

- **Inference:** routing by flow (Haiku for Intake, Sonnet for bookings) saves about $0.04 per Intake. It costs a second prompt to tune and eval, a cache rebuild whenever a conversation moves from Intake to booking, and a thinking-block hand-off rule. (Documented: Sonnet 5.5 reads Haiku 5.5 thinking blocks only on the Claude API and Google Cloud.)
- Escalating to Sonnet on failure brings the same costs, plus a slower worst case.
- At TutorLink's volume the saving does not pay for the complexity. Choose one model.

## Recommendation

1. **Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`):
   - adaptive thinking at `effort: "low"`, or `between_tools` if measured latency needs it;
   - `tool_choice: auto`, `strict: true` on every tool;
   - `fallbacks: "default"` on the Claude API.

   Expect about $0.04 per Intake and $0.035 per booking, cached.
2. **Prompt caching:** an identical tools list and system prompt on every request, with an explicit breakpoint at the end of the system prompt plus automatic caching for the tail. Date and Guardian record go after the breakpoint. 5-minute TTL.
3. **Architecture:** take the agent out of the TwiML response. Ack at once, show the typing indicator, run the loop in a worker, reply via the REST API. Keep the conversation append-only.
4. **Gate before launch:** build a scripted eval of about 30 conversations (English, Spanish and mixed; Intake, book, cancel, reschedule, ambiguous slot picks), run it on Sonnet 5.5 `low` and on Haiku 5.5 `low` and `medium`, and record per-call latency at p50 and p95. Switch to Haiku 5.5 only if it matches Sonnet on correct tool calls and correct Booking targets, and its latency gain is visible to Guardians. Revisit with real traffic, as the parser's docstring already plans.

### How to measure (open item)

There was no API key in this session. To replace the estimates in §2 and §3:

- Run `messages.count_tokens` on the real tools and system prompt.
- Log `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) and the wall time for every call in the eval.
- `scripts/parser_eval.py` is the model to copy: it uses a 30 s timeout because it measures quality, not latency.
