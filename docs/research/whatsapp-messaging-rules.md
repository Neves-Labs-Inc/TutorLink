# WhatsApp rules for reminders and messages outside the 24-hour window

Research for ticket #103 (map #102). Read on 2026-10-02.

**Method and caveat.** Pages were read through a fetch tool that summarises content, so quotes below are as returned by that tool, not byte-exact. Re-check the exact wording of anything load-bearing (especially Q1) on the live page before building on it. Each claim is tagged **Documented** (a source says it) or **Inference** (ours). Source pages carry no per-page "last updated" date unless stated; the Twilio key-concepts page showed 2026-09-25.

## Answers

### 1. Weekly Booking reminder: template, category, opt-in, cost

- **Documented:** a message the business starts outside an open 24-hour window must be a pre-approved template. Twilio error 63016 text: "business-initiated messages sent outside the 24-hour customer service window must use an approved template" ([Twilio 63016](https://www.twilio.com/docs/api/errors/63016)). Meta: outside the window "you can only send pre-approved template messages" ([Meta service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)).
- **Documented, categories:** every template is authentication, marketing or utility ([Meta template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)). Utility must be non-promotional with no "promotional or persuasive intent" AND be specific to or requested by the user, or essential to them. Appointment reminders are listed as a utility use case. Mixed utility plus marketing content is "considered marketing". "Retargeting" (promote or recommend services, or "other calls to action to users who ... engaged with you") "are marketing even if requested by users" ([Meta template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)). Meta can recategorise a utility template as marketing (24 hours notice, instant for repeat cases) and offers a category appeal within 60 days; Twilio says Meta "might override the category" ([Twilio approvals](https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses)).
- **Not documented:** Meta's page has no explicit ruling on a recurring "time to book" nudge.
- **Inference:** a weekly "you have no session booked next week, reply to book" is not tied to a specific booking the Guardian made, so it likely fits marketing, not utility. Plan for marketing; if utility is approved, treat it as a bonus. Take care not to word it as a promotion to keep utility possible.
- **Cost, documented:** since 2025-07-01 billing is per delivered template message by category and recipient country. Marketing templates are always charged, including inside an open window. Utility templates are free inside an open window and charged outside it. Free-form messages inside the window are free ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing); [Twilio key concepts](https://www.twilio.com/docs/whatsapp/key-concepts)). Rates by country were not read; check the Meta rate card.
- **Delivery limits, documented:** from 2025-04-01 Meta blocks marketing templates to US (+1) numbers; they fail with Twilio error 63049 ([Twilio changelog](https://www.twilio.com/en-us/changelog/whatsapp-marketing-messages-to-u-s--numbers-no-longer-supported), [63049](https://www.twilio.com/docs/api/errors/63049)). 63049 also appears when a non-US recipient is temporarily limited from more marketing templates, or when Meta classifies the template as marketing. **If Guardians have +1 numbers, a marketing reminder cannot be delivered over WhatsApp at all.** Utility category would be needed, or another channel. Whether TutorLink's Guardians are +1 is not stated in the ticket; Franklin must confirm.
- **Opt-in, documented:** WhatsApp "requires that your application implement explicit user opt-ins"; Twilio: opt-in "must be triggered by a user action", users "must be made aware of the type(s) of messaging they are signing up for", and Twilio may request proof of consent ([Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp/api); [Twilio rules](https://support.twilio.com/hc/en-us/articles/360017773294-Rules-and-Best-Practices-for-WhatsApp-Messaging-on-Twilio)). No fixed evidence format is documented. **Inference:** the intake sentence that tells the Guardian weekly reminders are coming (settled in the map) plus a stored timestamp and wording version is reasonable evidence; keep it.
- **Rate limits, documented:** default 80 messages per second per sender ([Twilio FAQ](https://www.twilio.com/docs/whatsapp/best-practices-and-faqs)). A sender whose display name Meta rejects is limited to 250 business-initiated messages per 24 hours ([Twilio self sign-up](https://www.twilio.com/docs/whatsapp/self-sign-up)). Meta's per-day business-initiated tiers were not read: not covered here.

### 2. Several Children in one message

- **Documented:** templates take numbered placeholders ({{1}}, {{2}}); body max 1024 characters in Meta, 1600 in Twilio's `twilio/text`; sample values are required at creation; a template may not start or end with a variable or have two variables adjacent without approval risk ([Meta components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components); [Twilio twilio/text](https://www.twilio.com/docs/content/twilio-text); [Twilio approvals](https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses)). `twilio/text` variables are plain strings; there is no list type. Twilio notes WhatsApp rejects multiple sequential line breaks ([Twilio changelog](https://www.twilio.com/en-us/changelog/whatsapp-template-console-redesign---translation-support)).
- **Not documented in the pages read:** a per-variable length cap, and whether newlines, tabs or runs of spaces are allowed inside a variable value (Meta's Cloud API docs are known to restrict them, but this was not confirmed from the pages fetched).
- **Inference:** use one fixed text with one variable holding a joined string such as "Ana, Luis and Marta" built by us, keeping it on one line (no newlines), plus one for the week. Do not rely on a variable list. Avoid a leading or trailing variable. Very long names lists risk the character limit; cap at a few names and fall back to "your children" wording if needed.

### 3. Spanish

- **Documented:** Meta does not translate: you supply strings and examples in each language, and "multiple templates with the same name but with different languages" each count toward the limit (6,000 translations per account) ([Meta fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview); [Twilio templates tutorial](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)). Twilio: "Each Content Template supports only one language" ([Twilio Content FAQ](https://www.twilio.com/docs/content/faqs-and-troubleshooting)). Twilio's older console flow let one template hold several translations, and WhatsApp reviews each translation separately ([Twilio changelog](https://www.twilio.com/en-us/changelog/whatsapp-template-console-redesign---translation-support)).
- **Answer:** each language is its own translation with its own approval. With Twilio Content API you send by ContentSid, so expect two Content Templates (English, Spanish), each with its own SID, same logical name. Choose the SID from the stored Guardian language. Whether the Content API can group both under one SID is **not documented**; the FAQ says no.

### 4. Approval

- **Documented:** Twilio: WhatsApp "typically approves or rejects it within minutes" via ML triage; ones needing human review "can take up to 48 hours"; pending beyond 48 hours, contact Twilio support. Meta says review "can take up to 24 hours" ([Twilio approvals](https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses); [Meta fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)).
- **Rejection reasons (documented, Twilio list):** variable at start or end, adjacent variables, non-sequential numbering, odd whitespace, duplicate names, policy violations, vague or too generic content, language mismatch, more than 10 emojis. Rejected names cannot be reused for 30 days: submit under a new name. Appeal via a Twilio support ticket. Templates get paused (3 hours, then 6, then deactivated) after recurring blocks or spam reports; alerts 63040/63041/63042 exist for rejected, paused, disabled ([Twilio tutorial](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)).
- **While waiting (inference, plan):** keep the feature behind a flag; reminders are skipped for a Guardian whose language template is not Approved; submit both languages early, since the Spanish text also needs a native review first.

### 5. Staff messages after more than 24 hours

- **Documented:** a free-form `Body` outside the window fails with Twilio **error 63016** ("Outside messaging window"). Causes listed include "Using `Body` instead of `ContentSid`" outside the window. The fix is a template via `ContentSid` (no Body or MediaUrl; use `ContentVariables`) or waiting for a new inbound message ([Twilio 63016](https://www.twilio.com/docs/api/errors/63016)).
- **Not documented:** whether Twilio rejects synchronously at the create call or later through the status callback. **Inference:** check the code both ways: store `error_code` from either path (the `messages.error_code` column exists).
- **Inference for TutorLink:** `send_whatsapp_message(to, body)` has no template path. To send Takeover or Hand-back notices after the window, we need approved utility-style templates ("A member of our team, {{1}}, has joined...") with a ContentSid path. Those notices are tied to the Guardian's own conversation, so they are the best fit for utility. A typed dashboard reply outside the window cannot be free-form; block the send and tell Staff. This supports the map's rule that a Takeover is blocked past 24 hours, though a template notice could be sent to reopen the conversation (a reply then opens the window, Q8).

### 6. How the window is measured

- **Documented:** it "lasts for 24 hours after the last inbound message you receive from a user"; each new inbound message resets the timer to 24 hours; user calls also start it ([Twilio key concepts](https://www.twilio.com/docs/whatsapp/key-concepts); [Meta service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)). Outbound messages from us do not extend it.
- **Exception, documented:** Meta's free entry point (click-to-WhatsApp ads or page buttons) gives a 72-hour window ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)). Not relevant unless TutorLink uses such ads.
- **Our data (verified in this repo at origin/develop):** `conversations.last_message_at` is bumped by any message including outbound, so it is wrong for this check. `messages` has `author_kind` and `created_at` (index on conversation_id, created_at), so the right value is `max(created_at)` of messages with `author_kind = client` (inbound) in the conversation; no new column is strictly needed, though a denormalised `last_inbound_at` would be cheaper. Inbound timestamps are our write time, not WhatsApp's, so allow a few minutes of safety margin (inference).

### 7. Opt-out

- **Documented:** WhatsApp "requires businesses to respect opt-out requests from end users". Users can also block the business inside WhatsApp, with no notification to us ([Twilio rules](https://support.twilio.com/hc/en-us/articles/360017773294-Rules-and-Best-Practices-for-WhatsApp-Messaging-on-Twilio)). Twilio's default account-wide STOP handling does **not** apply to WhatsApp senders. Twilio's Advanced Opt-Out on a Messaging Service can handle STOP-style keywords for WhatsApp, if configured ([Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)). Errors: 63050 and 63033 (recipient opted out of marketing; stop resending, track consent states, re-opt-in needed) ([63050](https://www.twilio.com/docs/api/errors/63050); [63033](https://www.twilio.com/docs/api/errors/63033)).
- **Answer:** nothing provides it for us by default. We must honour opt-out ourselves; the map's bilingual "from any clear message" design is compatible. Advanced Opt-Out keywords are English by default and would conflict with our own handling in Spanish, so do not combine them casually (inference). Keep an opt-out flag with timestamp and source, and treat 63050/63033 as an automatic opt-out signal.

### 8. Guardian reply to a template

- **Documented:** replying to a templated message "initiates the 24-hour customer service window, during which your business can send free-form messages" ([Twilio templates tutorial](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)). Meta's service-messages page does not address it explicitly, but its definition (any user message starts the timer) is consistent.
- **Answer:** yes. The reply is an ordinary inbound message: window opens, the bot can answer free-form via TwiML, and our webhook must treat the reply as part of the conversation.

## Unknowns

1. Whether "time to book" is approved as utility or marketing: only an actual submission shows it.
2. Where the Guardians' phone numbers are: +1 numbers cannot receive marketing templates at all (error 63049).
3. Per-country price per template and Meta's daily business-initiated limit tiers (not read).
4. Per-variable length and newline/tab rules (not confirmed from pages read); two Content Templates versus one SID for both languages.
5. Whether a 63016 failure appears synchronously on the REST create call or only in the status callback.
6. Whether Twilio's Advanced Opt-Out would intercept STOP before our webhook (matters for the opt-out design).
7. Exact opt-in evidence Twilio or Meta would accept in an audit: no format documented.

## Sources and read dates (all read 2026-10-02)

- https://www.twilio.com/docs/whatsapp/key-concepts (page date 2026-09-25)
- https://www.twilio.com/docs/api/errors/63016, /63049, /63050, /63033
- https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates
- https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses
- https://www.twilio.com/docs/whatsapp/api and /best-practices-and-faqs and /self-sign-up
- https://www.twilio.com/docs/content/twilio-text and /faqs-and-troubleshooting
- https://www.twilio.com/en-us/changelog/whatsapp-marketing-messages-to-u-s--numbers-no-longer-supported (effective 2025-04-01)
- https://www.twilio.com/en-us/changelog/whatsapp-template-console-redesign---translation-support
- https://support.twilio.com/hc/en-us/articles/360017773294-Rules-and-Best-Practices-for-WhatsApp-Messaging-on-Twilio
- https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview, /template-categorization, /components
- https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Not readable: business.whatsapp.com/policy (HTTP 403). Twilio's error-code-mapping page was fetched but its summary contradicted the 63016 page, so it was not used.
