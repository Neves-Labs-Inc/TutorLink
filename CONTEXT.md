# TutorLink

TutorLink connects Guardians with tutors for in-home sessions. Guardians book through a WhatsApp bot; Admins and Managers run everything else from the admin dashboard.

## Language

**Guardian**:
The parent or carer who books and manages sessions for a Child. The only person who talks to the bot.
_Avoid_: Client, parent, user

**Child**:
A student a Guardian books sessions for.
_Avoid_: Student, kid

**Account**:
A Guardian's saved details (their own, their Homes, their Children), created when a new number answers the Intake questions. Also the office's dashboard section for them, Accounts, with Children and Guardians tabs. A Guardian's details page is where the office manages their Homes.
_Avoid_: Profile, registration, People, Families

**Intake**:
The questions the bot asks a new Guardian to set up their Account.
_Avoid_: Onboarding, signup

**Child notes**:
What the office writes about a Child for the Tutors who teach them: needs, allergies, how to approach sessions. Tutors see them with each Session.
_Avoid_: Office notes, comments

**Overall grade**:
The grade a Guardian gives for a Child at Intake. An estimate for staff to see; it is not used to match tutors.
_Avoid_: Grade level

**Subject level**:
The grade a Child works at in one subject, set by an Admin or Manager. This is what tutors are matched against.
_Avoid_: Grade level, subject grade

**Tutoring booking**:
Any Booking that isn't an Evaluation session: ordinary teaching in a subject. A Booking's kind (Tutoring or Evaluation) never changes.
_Avoid_: Regular, normal, lesson

**Evaluation session**:
A Child's first session, arranged by the office, used to assess their Subject levels. Completing it does not make the Child Evaluated; that is a separate mark.
_Avoid_: Trial, first lesson, assessment

**Evaluated**:
A Child marked by an Admin or Manager, once, after their Evaluation session. Only an Evaluated Child can be booked through the bot.
_Avoid_: Graded, assessed

**Guardian language**:
English or Spanish. Detected from the Guardian's messages, stored, and used for every message to them, including Booking reminders.
_Avoid_: Locale, preferred language

**Booking reminder**:
A weekly message inviting a Guardian to book, sent only to Guardians with no session booked in the coming week. An Admin can pause sending for everyone with **Send Booking reminders**; while paused the bot still asks new Guardians whether they want them.
_Avoid_: Notification, nudge; "Reminders off" for the office-wide pause (that is one Guardian's Opt-out)

**Reschedule**:
A Guardian moving a live Booking through the bot. It replaces the Booking with a new one; its kind never changes.
_Avoid_: Move, edit

**Change booking**:
The office changing a live Booking's date, time, Staff, Location or Subject from the dashboard. It edits the Booking in place, its kind never changes, and the office tells the Guardian itself.
_Avoid_: Edit booking, reschedule (for the office's act)

**Opt-out**:
A Guardian's choice to stop receiving Booking reminders. On screen a Guardian has Reminders on, Reminders off, or has Never been asked.
_Avoid_: Unsubscribe, mute, consent, opted in/out

**Booking**:
An arranged meeting of a Child with Staff at a date, time and Location. The Office's word for it; Tutors see the same thing as a Session.
_Avoid_: Appointment, lesson, session (on Office screens)

**Session**:
A Booking as a Tutor sees it: a Tutor's own list is "My sessions", and a Manager's own teaching appears under "My sessions" too. Only Tutor-facing screens use this word.
_Avoid_: Booking (on Tutor screens), lesson, class

**Archive**:
Taking a Child, Guardian, Staff member, Home or Subject out of everyday use without deleting it; Restore brings it back. What archiving does depends on the thing: an archived Child's upcoming Bookings are cancelled, an archived Staff member can no longer sign in and their upcoming Bookings wait for the office to change them, an archived Subject can't be picked, an archived Guardian can no longer use the bot, and a Home can't be archived while it has upcoming Bookings. Only Admins archive Staff. Restore only brings the thing back: Bookings cancelled by the archive stay cancelled, and a restored Staff member signs in as before.
_Avoid_: Deactivate, inactive, delete

**Staff**:
The people a Booking can be with: Tutors, Admins, and Managers. Also the name of the Staff section listing all of them, where Admins add Staff and manage their teaching, time off and sign-in; Managers only view it.
_Avoid_: Employee, operator, users, team

**Tutor**:
A Staff member who teaches sessions. Sees only their own Bookings. Can exist before they can sign in.
_Avoid_: Teacher, instructor

**Location**:
Where a Booking happens: one of the Child's Homes, or In office. In office needs no address. A Home is an address saved on one or more Guardians (a couple living together share one Home), with optional directions for Staff (door code, parking, which entrance). A Child's Homes are simply every Home of every one of its Guardians, an archived Guardian's included; there is no separate choice of which Children go where. A Guardian can't be unlinked from a Child while the Child has upcoming Bookings at a Home that would no longer be theirs.
_Avoid_: Venue, place, home (for the general case), access code (say directions)

**Time off**:
Dates, or part of a day, when a Staff member can't be booked even though their Availability says otherwise. It may carry a short reason in the Staff member's own words; there are no reason categories. A Tutor's or Manager's time-off request takes effect once an Admin approves it (a Manager never approves time off, their own included); an Admin's time off, and time off an Admin enters for anyone, takes effect straight away. Only Admins approve or decline; an Admin may still approve a declined request. A Manager only requests their own time off, never enters it for others. Either the Staff member or an Admin can cancel pending or approved time off; cancelling is how a mistaken approval is undone. Time off can't be edited (cancel and request again), and nothing changes once it has ended: a request still undecided by then has Expired.
_Avoid_: Exception, day off, leave, unavailability, reject, withdraw, delete

**Availability**:
A Tutor's weekly slots in which Guardians can book them. Each slot says where it can be booked: Home visits (the Child's home only), Home or office, or Office only. This limits what the bot offers; the office can still book any Location. Admins have no Availability (the bot never offers them), but their Time off still blocks Bookings with them. Each Staff member sets their own Availability; only an Admin sets someone else's.
_Avoid_: Schedule (for the weekly pattern), shifts

**Admin**:
A Staff member with full dashboard access, including Staff sign-in and Settings. Can be booked, but is never offered to Guardians by the bot.
_Avoid_: Superuser, owner

**Manager**:
A Tutor with extra privileges: the same dashboard access as an Admin except Settings and changing Staff (they can view Staff but not add, edit or archive), plus their own Time off, their own Bookings through the Mine filter, and their Availability on their profile. A promoted Tutor: teaches sessions and is offered by the bot like any Tutor, and also takes over chats and runs Evaluation sessions. Does not approve time off.
_Avoid_: Supervisor, moderator

**Office**:
The Admins and Managers, who run TutorLink from the dashboard: bookings, chats, Children and Guardians. Every Office member is Staff, but not every Staff member is Office: Tutors are not.
_Avoid_: Staff (for this group), back office, admins (for the group)

**Sign-in state**:
Whether a Staff member can use the dashboard: Not invited (no password and never sent an Invite), Invited (no password, sent at least one Invite, even one that has since expired or been revoked), or Active (has chosen a password). An expired Invite still reads Invited; the office resends. Separate from being Archived.
_Avoid_: No login, registered, activated

**Invite**:
An email an Admin sends a Staff member who can't sign in yet, letting them choose their first password. Admins never set Staff passwords themselves.
_Avoid_: Activation, onboarding email

**Display name**:
The name an Admin or Manager goes by with Guardians, shown in the takeover message.
_Avoid_: Username, handle

**Takeover**:
An Admin or Manager taking a Guardian's chat from the bot so they can reply themselves. The Guardian is told who has joined. Only possible within 24 hours of the Guardian's last message; after that, they reach the Guardian outside the bot. A chat is either handled by the Bot or Taken over by a named Office member; another Office member can take it over from them.
_Avoid_: Escalation, handoff, human, held, transfer

**Hand-back**:
An Admin or Manager returning a chat to the bot after a Takeover. The Guardian is told the assistant is helping again.
_Avoid_: Release, resume

**Needs attention**:
A chat the bot has marked for the office, with a reason: an Office handoff (Wants to book, Has a question, Link request, Reactivation request) or a bot problem (Bot got stuck, Bot didn't understand). An Office member marks it done once dealt with.
_Avoid_: Flag, flagged, handled, parse error

**Unread**:
A chat where the Guardian has written since anyone in the office last opened it. Shared by the whole office: one person reading it makes it read for everyone. Only the Guardian's messages count; bot and office replies never make a chat Unread. Counted in chats, never in messages.
_Avoid_: New messages, unseen

**To do**:
The office's queue on Home: chats that Need attention and time-off requests waiting for an Admin. Admins see both; Managers see only chats. Booking work lives in To sort out instead. Each item is cleared by acting on it.
_Avoid_: Needs attention (for the whole queue), inbox, tasks, alerts

**To sort out**:
The banner above Bookings listing Booking work waiting on the office: Children awaiting evaluation with no Evaluation session booked, and Bookings to sort out (a past pending or confirmed Booking still not marked Completed once its day has ended, one that clashes with approved Time off, even if it was booked knowingly, or an upcoming one whose Staff member is archived). Approving Time off never cancels or refuses clashing Bookings; the Admin is warned and the clashes land here. An Admin may acknowledge a clash to keep the Booking as is, which clears it until the Booking's time or Staff member changes. Each Booking is listed once, with every reason it needs sorting out. Managers see Children awaiting evaluation and only their own Bookings to sort out. The Bookings nav item carries its count.
_Avoid_: Needs attention (that is the chat word), alerts

**Home**:
Where the office lands after sign-in: To do, then today's Bookings for Admins, or My sessions today for Managers.
_Avoid_: Dashboard, overview

**Mine**:
A Bookings filter for Managers showing only the Bookings they teach. Replaces the old Me area together with their profile (Availability) and the Time off section.
_Avoid_: Me, My stuff

**Office handoff**:
The bot passing a request to the office (Admins and Managers) to arrange, as it does for a first session or a subject with no Subject level. Distinct from a Takeover, where an Admin or Manager joins the chat.
_Avoid_: Escalation
