# TutorLink

TutorLink connects Guardians with tutors for in-home sessions. Guardians book through a WhatsApp bot; staff run everything else from the admin dashboard.

## Language

**Guardian**:
The parent or carer who books and manages sessions for a Child. The only person who talks to the bot.
_Avoid_: Client, parent, user

**Child**:
A student a Guardian books sessions for.
_Avoid_: Student, kid

**Account**:
A Guardian's saved details (their own, their home, their Children), created when a new number answers the Intake questions.
_Avoid_: Profile, registration

**Intake**:
The questions the bot asks a new Guardian to set up their Account.
_Avoid_: Onboarding, signup

**Overall grade**:
The grade a Guardian gives for a Child at Intake. An estimate for staff to see; it is not used to match tutors.
_Avoid_: Grade level

**Subject level**:
The grade a Child works at in one subject, set by staff. This is what tutors are matched against.
_Avoid_: Grade level, subject grade

**Evaluation session**:
A Child's first session, arranged by the office, used to assess their Subject levels.
_Avoid_: Trial, first lesson, assessment

**Evaluated**:
A Child marked by staff, once, after their Evaluation session. Only an Evaluated Child can be booked through the bot.
_Avoid_: Graded, assessed

**Guardian language**:
English or Spanish. Detected from the Guardian's messages, stored, and used for every message to them, including Booking reminders.
_Avoid_: Locale, preferred language

**Booking reminder**:
A weekly message inviting a Guardian to book, sent only to Guardians with no session booked in the coming week.
_Avoid_: Notification, nudge

**Opt-out**:
A Guardian's choice to stop receiving Booking reminders.
_Avoid_: Unsubscribe, mute

**Staff**:
The people who run TutorLink from the dashboard: Admins and Managers.
_Avoid_: Employee, operator

**Admin**:
A Staff member with full dashboard access, including Users and Settings.
_Avoid_: Superuser, owner

**Manager**:
A Staff member with the same dashboard access as an Admin except Users and Settings. Can use chat and evaluate Children.
_Avoid_: Supervisor, moderator

**Display name**:
The name a Staff member goes by with Guardians, shown in the takeover message.
_Avoid_: Username, handle

**Takeover**:
A Staff member taking a Guardian's chat from the bot so they can reply themselves. The Guardian is told who has joined.
_Avoid_: Escalation, handoff

**Hand-back**:
A Staff member returning a chat to the bot after a Takeover. The Guardian is told the assistant is helping again.
_Avoid_: Release, resume

**Office handoff**:
The bot passing a request to Staff to arrange, as it does for a first session or a subject with no Subject level. Distinct from a Takeover, where Staff join the chat.
_Avoid_: Escalation
