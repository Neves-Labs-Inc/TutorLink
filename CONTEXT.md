# TutorLink

TutorLink connects Guardians with tutors for in-home sessions. Guardians book through a WhatsApp bot; Admins and Managers run everything else from the admin dashboard.

## Language

**Guardian**:
The parent or carer who books and manages sessions for a Child. The only person who talks to the bot. Their saved details (their own, their Homes, their Children) are created when a new number answers the Intake questions.
_Avoid_: Client, parent, user, Account, profile

**Child**:
A student a Guardian books sessions for.
_Avoid_: Student, kid

**Family**:
Guardians joined through the Children they share, with all those Children and their Homes; a blended family, where one Guardian shares Children with two others, is one family. Nothing stores a family; it follows from who is linked to whom, and its name comes from its Guardians' surnames. Every Child has at least one Guardian. A family is archived once all its Guardians are. Also the office's dashboard section, Families: a list of families, each opening into one overview (Children, the family's Bookings by week, Guardians and Homes). Adding a Child or a Guardian starts a new family. On the family's overview the office adds Guardians and Children, choosing which Children a new Guardian is linked to and which Guardians a new Child belongs to (all of them by default), and adds, changes and archives Homes.
_Avoid_: Account, Accounts (for the section), household (in the UI), people, registration

**Intake**:
The questions the bot asks a new Guardian to set up the Guardian and their Children. The office adds Guardians and Children directly, without Intake.
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
A Child marked by an Admin or Manager, once, after their Evaluation session. Marking a Child Evaluated sets their Assigned Tutors (at least one). Only an Evaluated Child can have Tutoring booked, by the bot or the office; before that, only an Evaluation session.
_Avoid_: Graded, assessed

**Assigned Tutors**:
The Tutors and Managers a Child may be booked with through the bot, set for the Child as a whole (not per Subject) by an Admin or Manager, from the Child or from the Staff member. The bot offers only Assigned Tutors who cover the Child's Subject level; if none of them do, it makes an Office handoff. Admins are never Assigned Tutors. The office may still book anyone, with a warning. A Child left with none, because the last was removed or archived, waits in To do until the office assigns one.
_Avoid_: Preferred tutor, regular tutor, matched tutor

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
The office changing a live Booking's date, time, Staff, Location or Subject from the dashboard. It edits the Booking in place, its kind never changes, it is refused if someone else changed the Booking since it was opened, and the office tells the Guardian itself.
_Avoid_: Edit booking, reschedule (for the office's act)

**Opt-out**:
A Guardian's choice to stop receiving Booking reminders. On screen a Guardian has Reminders on, Reminders off, or has Never been asked.
_Avoid_: Unsubscribe, mute, consent, opted in/out

**Booking**:
An arranged meeting of a Child with Staff at a date, time and Location. The Office's word for it; Tutors see the same thing as a Session. It is Pending or Confirmed while live, then Completed, Didn't happen or Cancelled. The office can re-open a Completed or Didn't happen Booking, and restore a future Cancelled one while its Child and Staff member are active and the slot is free; a Tutor can only mark their own Session Completed once it has started. Cancelling asks first; Completed and Didn't happen have an Undo.
_Avoid_: Appointment, lesson, session (on Office screens)

**Didn't happen**:
A Booking that was due but did not take place, marked by an Admin or Manager once it has started. Separate from Cancelled, which is called off beforehand.
_Avoid_: No-show (in the UI), missed, cancelled (for this)

**Session**:
A Booking as a Tutor sees it: a Tutor's own list is "My sessions", and a Manager's own teaching appears under "My sessions" too. Only Tutor-facing screens use this word.
_Avoid_: Booking (on Tutor screens), lesson, class

**Archive**:
Taking a Child, Guardian, Staff member, Home or Subject out of everyday use without deleting it; Restore brings it back. What archiving does depends on the thing: an archived Child's upcoming Bookings are cancelled, an archived Staff member can no longer sign in and their upcoming Bookings wait for the office to change them, an archived Subject can't be picked, an archived Guardian can no longer use the bot (and archiving a family's last active Guardian also archives its Children, whose upcoming Bookings are cancelled), and a Home can't be archived while it has upcoming Bookings. Only Admins archive Staff. Restore only brings the thing back: Bookings cancelled by the archive stay cancelled (the office may restore them one by one), and a restored Staff member signs in as before.
_Avoid_: Deactivate, inactive, delete

**Staff**:
The people a Booking can be with: Tutors, Admins, and Managers. Also the name of the Staff section listing all of them, where Admins add Staff and manage their teaching, time off and sign-in; Managers only view it.
_Avoid_: Employee, operator, users, team

**Tutor**:
A Staff member who teaches sessions. Sees only their own Bookings, and with each one only the Guardian's name, the Home address and its directions, and the Child notes; never other Guardian details such as phone or email (they reach the Guardian through the office). Can exist before they can sign in.
_Avoid_: Teacher, instructor

**Location**:
Where a Booking happens: one of the Child's Homes, or In office. In office needs no address. A Home is an address saved on one or more Guardians (a couple living together share one Home; a new Home belongs to the Guardians the office picks, all of the family's by default), with optional directions for Staff (door code, parking, which entrance). A Child's Homes are simply every Home of every one of its Guardians, an archived Guardian's included; there is no separate choice of which Children go where. A Guardian can't be unlinked from a Child while the Child has upcoming Bookings at a Home that would no longer be theirs.
_Avoid_: Venue, place, home (for the general case), access code (say directions)

**Time off**:
Dates, or part of a day, when a Staff member can't be booked even though their Availability says otherwise. It may carry a short reason in the Staff member's own words; there are no reason categories. A Tutor's or Manager's time-off request takes effect once an Admin approves it (a Manager never approves time off, their own included); an Admin's time off, and time off an Admin enters for anyone, takes effect straight away. Only Admins approve or decline; an Admin may still approve a declined request. A Manager only requests their own time off, never enters it for others. The Staff member can cancel their own pending or approved time off, and an Admin can cancel approved time off; an Admin decides someone else's pending request (Approve or Decline) but never cancels it for them. Cancelling is how a mistaken approval is undone. Time off can't be edited (cancel and request again), and nothing changes once it has ended: a request still undecided by then has Expired.
_Avoid_: Exception, day off, leave, unavailability, reject, withdraw, delete

**Availability**:
A Tutor's weekly slots in which Guardians can book them. Each slot says where it can be booked: Home visits (the Child's home only), Home or office, or Office only. This limits what the bot offers; the office can still book any Location. Admins have no Availability (the bot never offers them), but their Time off still blocks Bookings with them. Each Staff member sets their own Availability; only an Admin sets someone else's.
_Avoid_: Schedule (for the weekly pattern), shifts

**Admin**:
A Staff member with full dashboard access, including Staff sign-in and Settings. Can be booked, but is never offered to Guardians by the bot.
_Avoid_: Superuser, owner

**Manager**:
A Tutor with extra privileges: the same dashboard access as an Admin except Settings and changing Staff (they can view Staff, including everyone's schedules, Time off and clashes, but not add, edit or archive), plus their own Time off, their own Bookings through the Mine filter, and their Availability on their profile. A promoted Tutor: teaches sessions and is offered by the bot like any Tutor, and also takes over chats and runs Evaluation sessions. Does not approve time off.
_Avoid_: Supervisor, moderator

**Office**:
The Admins and Managers, who run TutorLink from the dashboard: bookings, chats, Children and Guardians. Every Office member is Staff, but not every Staff member is Office: Tutors are not.
_Avoid_: Staff (for this group), back office, admins (for the group)

**Sign-in state**:
Whether a Staff member can use the dashboard: Not invited (no password and never sent an Invite), Invited (no password, sent at least one Invite, even one that has since expired or been revoked), or Active (has chosen a password). An expired Invite still reads Invited; the office resends. Separate from being Archived.
_Avoid_: No login, registered, activated

**Invite**:
An email an Admin sends a Staff member who can't sign in yet, letting them choose their first password. Admins never set Staff passwords themselves. Its link opens a Welcome page showing the person's name and email, distinct from a password reset; an expired Invite asks them to have the office resend it.
_Avoid_: Activation, onboarding email

**Display name**:
The name an Admin or Manager goes by with Guardians, shown in the takeover message.
_Avoid_: Username, handle

**Takeover**:
An Admin or Manager taking a Guardian's chat from the bot so they can reply themselves. The Guardian is told who has joined. Only possible within 24 hours of the Guardian's last message; after that, they reach the Guardian outside the bot, and a chat still Taken over when its window closes goes back to Needs attention (Reply window closed). A chat is either handled by the Bot or Taken over by a named Office member; another Office member can take it over from them.
_Avoid_: Escalation, handoff, human, held, transfer

**Hand-back**:
An Admin or Manager returning a chat to the bot after a Takeover. The Guardian is told the assistant is helping again (unless the reply window has closed). Handing back also marks the chat done, except a pending Reactivation request, which only Restore or Decline clears.
_Avoid_: Release, resume

**Needs attention**:
Work the office must act on. For a chat: one the bot has marked for the office, with a reason: an Office handoff (Wants to book, Has a question, Link request, Reactivation request) a bot problem (Bot got stuck, Bot didn't understand), or Reply window closed on a taken-over chat. An Office member marks it done once dealt with (with an Undo), and Hand-back marks it done too. A Reactivation request is settled with Restore or Decline instead; Decline sends the Guardian nothing, so the office tells them itself. On the Bookings page, Needs attention is also the quick filter for Booking work (see Bookings to sort out), where To do's See all lands.
_Avoid_: Flag, flagged, handled, parse error

**Unread**:
A chat where the Guardian has written since anyone in the office last opened it. Shared by the whole office: one person reading it makes it read for everyone. Only the Guardian's messages count; bot and office replies never make a chat Unread. Counted in chats, never in messages.
_Avoid_: New messages, unseen

**To do**:
The office's queue on Home, in three groups: Chats that Need attention, Bookings waiting on the office (see Bookings to sort out), and Time off requests waiting for an Admin. Admins see all three; Managers see Chats and, in Bookings, the Children awaiting evaluation or needing a Tutor plus their own Bookings to sort out (for any reason). Bookings are ordered: to change (soonest), needing a Tutor, unmarked (oldest), Evaluations to book (longest waiting); Time off requests oldest first. Time off decisions send after a short delay with an Undo. Rows only open the item's details, where it is acted on; each item is cleared by acting on it.
_Avoid_: Needs attention (for the whole queue), inbox, tasks, alerts

**Bookings to sort out** (code and API name only):
Booking work waiting on the office, shown as the Bookings group in To do: Children awaiting evaluation with no Evaluation session booked, Evaluated Children with no Assigned Tutors, and Bookings to sort out (a past pending or confirmed Booking still not marked Completed once its day has ended, one that clashes with approved Time off, even if it was booked knowingly, or an upcoming one whose Staff member is archived). Approving Time off never cancels or refuses clashing Bookings; the Admin is warned and the clashes land here. An Admin may acknowledge a clash to keep the Booking as is, which clears it until the Booking's time or Staff member changes. Each Booking is listed once, with every reason it needs sorting out. The Bookings nav item carries the count of both. The UI never says "To sort out"; its label for this on the Bookings page is still open.
_Avoid_: To sort out (in the UI), alerts

**Home**:
Where the office lands after sign-in: To do, then today's Bookings for Admins, or My sessions today for Managers.
_Avoid_: Dashboard, overview

**Mine**:
A Bookings filter for Managers showing only the Bookings they teach. Replaces the old Me area together with their profile (Availability) and the Time off section.
_Avoid_: Me, My stuff

**Office handoff**:
The bot passing a request to the office (Admins and Managers) to arrange, as it does for a first session, a subject with no Subject level, or a subject none of the Child's Assigned Tutors teach. Distinct from a Takeover, where an Admin or Manager joins the chat.
_Avoid_: Escalation
