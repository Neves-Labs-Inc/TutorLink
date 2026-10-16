# TutorLink Dashboard Design System

Status: **APPROVED by Franklin** (2026-10-16). Replaces the 2026-10-01 version, which
described the old indigo/Geist dashboard.
Scope: `dashboard/` (Vite + React 19 + Tailwind v4, lucide icons), every Office, Tutor and auth
surface of the big-bang redesign (map: TutorLink#180).

This file is the law for design briefs and design reviews. When it and a prototype disagree,
**this file wins**; §17 lists the known prototype drift the build must not copy.

**Sources of truth, in order**

1. The approved shared kit: `dashboard/src/pages/prototype/shell-kit/kit/` (written `kit/` below).
   Its tokens and components are approved. Reference them by path; do not copy their code into briefs.
2. The visual direction **Faithful pastel** (TutorLink#187; `/prototype/visual-direction?variant=A`).
3. The approved area prototypes, for patterns in use: `dashboard/src/pages/prototype/{home,bookings,chats,accounts-staff,settings,tutor-timeoff,auth}/`
   (routes `/prototype/<area>`, each with `?theme=dark` and `?device=phone`).
4. `CONTEXT.md` for every word on screen (§15).

---

## 1. Product tone

An office and tutoring tool for **M's Helping Hands**, drawn from the public website: soft light
blue, pastel accents, thin Lato titles over Inter, round shapes, soft blue shadows. It should feel
warm and calm, not corporate, while staying a work tool: comfortable density (44px controls,
72px rows), one clear primary action per view, status always spelled out in words.

- Colour carries meaning: blue is the brand and "yours/active", pink is Evaluation, yellow is
  notes and routine handoffs, the status tones are status. Decoration is limited to the canvas glow.
- No illustrations, no emoji, lucide icons only (`aria-hidden`, sized 16/18/20px).
- Copy is short, plain, sentence case, in `CONTEXT.md` words (§15).

## 2. Colour tokens

### 2.1 How tokens work

- One source: `kit/tokens.ts` (`LIGHT`, `DARK`, `PRIMARY_RAMP`). `kit/kit-root.tsx` writes them as
  `--tl-<name>` custom properties on the `[data-kit]` root, sets `data-theme` and `color-scheme`.
- Components read them only through Tailwind's variable syntax: `bg-(--tl-surface)`,
  `text-(--tl-muted)`, `border-(--tl-field-border)`. Tone pairs come from `TONE_CLASSES` in
  `kit/tokens.ts`.
- **Never** raw hex, `rgb()`, Tailwind palette colours (`gray-*`, `red-500`, `white`), or
  shadcn names (`bg-primary`, `text-muted-foreground`) in redesigned UI. Exceptions, both
  deliberate: the email preview in Settings (renders the email as sent, fixed light colours,
  `settings/components/email-editor.tsx`) and the logo's white disc (`auth/components/logo-medallion.tsx`).
- Every token has a dark value. A new token is a decision for Franklin and must land in both
  `LIGHT` and `DARK` with its contrast stated.

### 2.2 Roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F4F9FB` | `#0E1A26` | App background (with the `glow`/`glow-pink` radial wash from `kit/kit.css`); phone detail pages |
| `surface` | `#FFFFFF` | `#152433` | Cards, sidebar, tab bar, sheets, dialogs, popovers, field fill |
| `surface-sunk` | `#EEF5F8` | `#11202E` | Segmented-control track, disabled fields, inline "All clear" / empty wells, calendar day columns |
| `tint` | `#E8F4F8` | `#1B2E40` | Hover fill, soft button, icon chips, eyebrow pill, today column |
| `tint-strong` | `#D6EDF5` | `#233D50` | Active nav/tab fill, active filter pill, pressed option, Tutoring calendar block |
| `hero` | `#ADD8E6` | `#ADD8E6` | Brand light blue: wordmark disc, auth panel, ListRow hover border. Never text on white |
| `primary` / `primary-hover` / `on-primary` | `#1F6F8B` / `#175A72` / `#FFF` | `#ADD8E6` / `#C6E6F0` / `#0B1724` | Filled buttons, active tab underline, checked controls, today marker |
| `link` | `#175A72` | `#ADD8E6` | Text links, ghost buttons, inline Select, check marks |
| `primary-ink` | `#0F4C61` | `#CDEAF3` | Text on `tint`/`tint-strong` |
| `ink` / `ink-soft` / `muted` | `#14212E` / `#334155` / `#5A6B7B` | `#E6F0F5` / `#C4D3DD` / `#9DB3C2` | Body text / secondary text / captions, meta, placeholders, labels |
| `border` | `#DCE8EF` | `#26394C` | Dividers, outline buttons, filter pills |
| `card-border` | `#E6EFF4` | `#22364A` | Card and overlay outlines |
| `field-border` | `#8397A6` | `#5F7A90` | Inputs, Select triggers, checkbox, radio, switch-off (3:1 against `surface`, WCAG 1.4.11) |
| `focus` | `#1F6F8B` | `#ADD8E6` | The one focus ring (§14) |
| `inverse` / `on-inverse` / `inverse-link` | `#14212E` / `#F4F9FB` / `#ADD8E6` | `#E6F0F5` / `#0E1A26` / `#175A72` | Toasts only |
| `skeleton` | `#E3EDF2` | `#1F3242` | Skeleton shimmer base |
| `scrim` | `rgba(20,33,46,.32)` | `rgba(4,10,16,.6)` | Behind every modal overlay |

### 2.3 Status and accent tones

Each tone is a text colour on its own tint, applied as one pair through `TONE_CLASSES[tone]`.
Every pair is at least 4.5:1 in both themes (light: success 4.75, warning 5.31, danger 5.46,
neutral 6.2, pink 7.15, yellow 7.03, green 5.93; dark all ≥ 7).

| Tone | Light text / tint | Meaning |
|---|---|---|
| `info` | `#175A72` / `#E1F1F7` | Confirmed, neutral information |
| `success` | `#1E7A43` / `#E3F6E8` | Done, approved, active, on |
| `warning` | `#8A5A00` / `#FFF2CC` | Waiting on someone, needs sorting out, pending |
| `danger` | `#B42335` / `#FFE5EA` | Cancelled, declined, failed, bot problem, destructive |
| `neutral` | `#4B5B6A` / `#EDF2F5` | Archived, off, bot, expired, cancelled time off |
| `primary` | `#0F4C61` / `#D6EDF5` | Tutoring, taken over, "yours" |
| `pink` | `#8A2846` / `#FFE5EC` | **Evaluation** and Awaiting evaluation, To do counts |
| `yellow` | `#6B5300` / `#FFFBE0` | Child notes, routine Office handoffs, time off on a calendar, permission state |
| `green` | `#1E6B34` / `#E8F8E8` | Availability (slot locations, free bands) |

Domain badges in `kit/components/badges.tsx` fix the tone for each `CONTEXT.md` state; use them, never
a bare `Badge` with a chosen tone, when one exists:

| Badge | Mapping |
|---|---|
| `BookingStatusBadge` | Pending warning · Confirmed info · Completed success · Didn't happen neutral + CircleSlash · Cancelled danger (Didn't happen is added to the kit, §17 #2) |
| `KindBadge` | Tutoring primary + BookOpen · Evaluation pink + Sparkles |
| `TimeOffBadge` | Pending warning · Approved success · Declined danger · Cancelled neutral · Expired neutral + Hourglass (Expired is added to the kit, §17 #2) |
| `AttentionBadge` | Office handoffs (Wants to book, Has a question, Link request, Reactivation request) yellow · bot problems (Bot got stuck, Bot didn't understand) danger · Reply window closed warning + Clock (added to the kit, §17 #2) |
| `ChatHandlerBadge` | Bot neutral + Bot · Taken over by {first name / you} primary + UserRound |
| `SignInBadge` | Not invited neutral · Invited warning · Active success |
| `RemindersBadge` | Reminders on success · Reminders off neutral · Never asked warning |
| `EvaluatedBadge`, `ArchivedBadge`, `SlotLocationBadge` | success / pink, neutral + Archive, green + Home/Building |
| `CountBadge` | `primary` (unread chats), `pink` (waiting: To do, Bookings, Time off, More), `quiet` (inactive tab counts) |

### 2.4 Calendar colours

- **Bookings calendar** (`bookings/components/time-grid.tsx`) colours by **kind**: Tutoring
  `tint-strong`/`primary-ink`, Evaluation `pink`. A Booking that needs attention switches to a
  2px `warning` border on `warning-tint` plus its reason icon. Time off is a yellow pill under the
  column header; Availability is shaded `green-tint`; "now" is a 2px `danger` line with a dot.
- **Family week** (`accounts-staff/components/family-week.tsx`, `booking-block.tsx`) colours by
  **Child**, in the family's Child order: `primary`, `green`, `yellow`, `pink` (pink last because
  it means Evaluation elsewhere). Each block is the tone pair plus a 4px left bar in the tone's
  ink; Evaluation still carries the Sparkles icon. A legend of dots plus first names shows when
  the family has two or more Children. **From the fifth Child on**, blocks are neutral (`neutral` tone, `border` bar) and the first name is the only marker; the legend lists those Children by name without a dot (#235).
- **Cancelled** Bookings, in both calendars: `surface-sunk` fill, `border` bar, `muted` text,
  name struck through, and the word "Cancelled" in the block. No hatching, dashed borders or
  opacity. Colour is never the only signal (time, name and status word are always in the block
  or its `aria-label`).

### 2.5 Dark mode

Both themes are first-class; every screen is designed and reviewed in both. Dark keeps the
light-blue brand as the fill (`primary` = `#ADD8E6` with dark labels). Shadows become dark,
low-spread drop shadows with a faint inset top highlight. The theme follows the OS by default,
and Profile offers Light / Dark / System (§16).

## 3. Typography

- **Inter** (400–700, `font-feature-settings: "cv11","ss01"`) for all UI and body text: the `[data-kit]` default.
- **Lato** via `.kit-display`: 300 (light) for page titles, empty/error titles and the
  wordmark; 700 (bold) for headings, card titles, dialog and sheet titles.
- Nothing under **12px**. Use `tabular-nums` for times, dates,
  counts and money.
- Prefer the shared class sets in `kit/tokens.ts` (`TITLE`, `HEADING`, `CARD_TITLE`, `EYEBROW`).

| Role | Size / line height, weight | Where |
|---|---|---|
| Page title | `TITLE`: Lato 300 34/42, 44/52 from `@5xl`, tracking −0.01em | `PageHeader` h1, auth h1 |
| Auth title (small) | Lato 300 30/38, 34/42 from `@5xl` | Secondary auth screens |
| Dialog title | Lato 700 22/30 | `Dialog` |
| Empty / error title | Lato 300 22/30 | `EmptyState`, `ErrorState` |
| Heading | `HEADING`: Lato 700 20/28 | Sheet titles, section headings ("To do", "Today's bookings") |
| Card title | `CARD_TITLE`: Lato 700 17/24 | Card heads, ListRow titles |
| Body | Inter 15/24 | Paragraphs, field values, dialog body, `DetailRow` values |
| UI | Inter 14/20, 500 (600 for labels and active) | Buttons, field labels, table cells, nav items, toasts |
| Caption | Inter 13/18 | Help and error text, subtitles, `DetailRow` labels |
| Eyebrow / badge / table header | Inter 12/16, 600; eyebrow and `th` uppercase, tracking 0.14em | `EYEBROW`, `Badge`, `CountBadge`, tab-bar labels |

## 4. Spacing and layout scale

Tailwind's 4px scale. Values in use, by job:

| Job | Value |
|---|---|
| Page gutter | `px-4` phone, `@2xl:px-6`, `@5xl:px-10`; content `max-w-[1280px]` centred (`kit/shell/app-shell.tsx`) |
| Page header | `pt-5 pb-6`, `@5xl:pt-6 @5xl:pb-8`, `gap-5` between title row, tabs and toolbar |
| Section stack | `gap-6`; heading to content `mb-3` |
| Card padding | `p-4`, `@2xl:p-5` (or `px-5` / `@2xl:px-6` in overlays) |
| Card grid / list gap | `gap-3` (lists of cards), `gap-4` (card grids) |
| Field stack | `gap-4`; label to control `gap-1.5` |
| Toolbar | `gap-3` (rows), `gap-2` (filter pills) |
| Row height | 72px minimum (table rows, phone rows); ListRow 76px from `@2xl` |
| Control height | 44px (`h-11`) everything interactive; segmented control 48px total |

## 5. Radius

| Radius | Use |
|---|---|
| `rounded-full` | Buttons, icon buttons, inputs, Select triggers, filter pills, badges, nav items, avatars, skeleton bars, count badges |
| 12px | Calendar Booking blocks |
| 14px | Icon chips (40px squares), option rows in listboxes and the More sheet tiles, calendar day columns |
| 16px | Radio cards, `TimeBlock`, inline wells ("All clear", empty week), card-level errors |
| 18px | `NotesCard`, More-sheet rows |
| 20px | Cards (`CARD`), popovers, toasts, textareas, `InlineError`, `OfflineBanner`, `FormAlert` |
| 28px | Sheets, dialogs, `DetailOverlay` slide-over, sidebar, bottom tab bar, auth brand panel |

No other radii (prototype strays at 10, 22 and 24px move to 14, 20 and 28px, §17 #10).

## 6. Elevation

Two shadows only, both tokens, applied with `.kit-shadow-soft` / `.kit-shadow-raised` (`kit/kit.css`):

| Level | Use |
|---|---|
| none + `card-border` | Inline wells, inputs, outline buttons |
| `shadow-soft` | Cards (`CARD`), sidebar, primary button, segmented-control thumb, logo disc |
| `shadow-raised` | Everything that floats: sheets, dialogs, `DetailOverlay`, popovers and listboxes, toasts, bottom tab bar, Settings Save bar |

Never Tailwind `shadow-sm|md|lg|xl` or `brightness-*` in product UI; a lifted calendar block on hover uses `shadow-raised`. Modal overlays add the `scrim`.

## 7. Z-layers

| z | Layer | Owner |
|---|---|---|
| 0 | Page content | — |
| 10 | Lifts inside a component: table row content over its stretched button, calendar blocks, a pinned `DetailOverlay` header, the Settings Save bar | `data-table.tsx`, `time-grid.tsx`, `detail-overlay.tsx`, `save-bar.tsx` |
| 20 | Sticky app chrome: bottom tab bar; hovered calendar block | `bottom-tab-bar.tsx` |
| 30 | Sticky axes in the time grid; in-flow `Combobox` listbox | `time-grid.tsx`, `combobox.tsx` |
| 40 | In-flow popovers: `MultiSelectFilter` | `multi-select-filter.tsx` |
| 50 | Modal overlays: `Dialog`, `BottomSheet`, `DetailOverlay`. Stacked overlays share z-50 and order by mount; only the top one is live (`overlays/overlay-stack.ts`) | `overlays/*` |
| 60 | Portaled `Select` popover (paints over an open sheet or dialog); toasts | `select.tsx`, `toast-provider.tsx` |

A new layer needs a row here. Do not use `z-[999]`-style escapes.

## 8. Breakpoints and responsive layout

Mobile first. **Design at 390px (the phone frame, 390×844) first**, check at 320px, then scale up.
Responsive classes are **container queries** on the kit root (`@container` in `kit-root.tsx`), not
viewport media queries, so a component laid out in a narrow column behaves as on a phone.
`DataTable`, `ListRow` and `family-week` are their own containers and query their own width.

| Kit width | Query | What changes |
|---|---|---|
| < 448 | base | Phone. One column; footers stack (primary on top); toolbar filters scroll sideways |
| ≥ 448 | `@md` | Sheet and dialog footers go side by side, right-aligned; list skeleton shows its badge bar |
| ≥ 672 | **`@2xl`** | **The overlay split.** `BottomSheet` becomes a centred 480px dialog; `Select` and `MultiSelectFilter` open popovers instead of sheets; `DetailOverlay` becomes a 440px slide-over with scrim instead of a pushed page; the page's primary action shows its label (an icon button below); gutters widen; `ListRow` goes one-line; radio cards may go 3-up |
| ≥ 768 | `@3xl` | `DataTable` renders a table (rows below); `PageToolbar` goes inline; family week becomes a 7-day grid; Bookings calendar becomes a time grid (a day agenda below); page header secondary actions appear |
| ≥ 1024 | `@5xl` | Floating sidebar replaces the top bar + bottom tab bar; `isWideOnly` table columns appear; page title 44/52; auth brand panel goes side by side; toasts move bottom-right; Settings jump list becomes a sticky column |
| ≥ 1152 | `@6xl` | Home To do goes 3-up (Admins); Chats shows list and thread side by side |

The 672px split is implemented twice: as `@2xl` in classes and as `WIDE_KIT_WIDTH = 672` /
`POPOVER_MIN_KIT_WIDTH = 672` in `overlays/use-enter-animation.ts`, `multi-select-filter.tsx` and
`types/select.ts`. Change both together. No JS breakpoints off this scale.

Rules:

- **No page-level horizontal scroll** at any width. Allowed sideways scrollers, all with hidden
  scrollbars (`.kit-no-scrollbar`) and edge bleed (`-mx-4 px-4`): the phone filter-pill row,
  `SubPageTabs`, the Settings jump-list pills, a `SegmentedControl` that overflows, and the
  Bookings Day-by-Staff time grid inside its card.
- Respect safe areas: bottom bars and overlay footers pad `max(12–16px, env(safe-area-inset-bottom))`.
- Phone-only floating things clear the tab bar: toasts `bottom-[104px]`, Save bar `bottom-[92px]`.
- Inputs are 15px, so iOS does not zoom.

## 9. App shell and navigation

Owners: `kit/shell/app-shell.tsx`, `sidebar.tsx`, `bottom-tab-bar.tsx`, `nav.ts`, `page-header.tsx`,
`page-toolbar.tsx`, `wordmark.tsx`.

- **≥1024:** floating rounded sidebar (248px, 28px radius, `shadow-soft`), wordmark on top, nav,
  and the signed-in person's card at the foot (opens Profile).
- **<1024:** compact top bar (compact wordmark, avatar → Profile) and a floating pill bottom tab
  bar. Up to 5 tabs; with more items the first 4 show and the rest go under **More** (a
  `BottomSheet`), which carries the sum of its items' badges.
- Nav per role (`nav.ts`): Admin: Home · Bookings · Chats · Families · Staff · Time off · Settings.
  Manager: the same without Settings (own sessions via the **Mine** filter and Home; Availability on
  their Profile). Tutor: My sessions (landing) · My availability · Time off.
- Nav badges: Bookings = to sort out + Evaluations to book (pink), Chats = unread (primary),
  Time off = pending, Admins only (pink). Home has no badge. While counts load, no badges show.
- Every page starts with `PageHeader`: optional eyebrow, Lato title, optional description,
  **one** primary action (labelled from `@2xl`, round icon button below with the same name),
  then `SubPageTabs`, then `PageToolbar` (search, one `MultiSelectFilter` per field, quick
  filters, "Clear all" once any is on, view switch on the right).
- A record that is a page of its own (the family overview) has a "← Families" back link above the title.

## 10. Component inventory

Reuse these before writing anything. A new primitive is a decision for Franklin. Paths are under `kit/`.

### Actions

| Need | Owner | Rules |
|---|---|---|
| Button | `components/button.tsx` `Button` | 44px pill. Variants: `primary` (one per view: the page's main act or the overlay's commit), `soft` (secondary act in a card, Done in popovers), `outline` (default; neutral acts, Keep/Back), `ghost` (low-key: Clear, See all in Bookings), `danger` (**only** the confirm button of a destructive `ConfirmDialog`), `danger-outline` (the trigger of a destructive act, e.g. Cancel booking, Archive, in a details footer). `isLoading` swaps the icon for a spinner, sets `aria-busy` and disables |
| Icon-only action | `IconButton` | 44px circle, `label` required (becomes `aria-label` and `title`). `plain`, `outline`, `primary` |
| Inline link-like action | `TextLink` | "See all 7", "Open chat"; pads to 44px tall without moving text |

### Fields

| Need | Owner | Rules |
|---|---|---|
| Text, email, tel, number, date, time | `components/fields.tsx` `TextField` | Visible label always; `help` under the field; `error` replaces help, says what to do, carries an icon; "(required)" after the label when required |
| Long text | `TextAreaField` | 20px radius, resizes vertically |
| Password | `auth/components/password-field.tsx` (to promote into the kit) | Show/Hide toggle; never blocks paste or managers |
| Short fixed list (≤ ~12 options) | `components/select.tsx` `Select` / `SelectField` | Popover from 672px, bottom sheet titled with the label below. `variant="inline"` for a choice inside a sentence or toolbar. Never a native `<select>` |
| Long or searchable list (Staff, Children, Guardians) | `components/combobox.tsx` `Combobox` | Type to filter; options may carry an avatar and a second line; "No matches for “x”." Below 672px it opens as a `BottomSheet` titled with the label, search field on top, like `Select` |
| On/off setting | `components/choices.tsx` `SwitchField` | Whole row is the hit area; takes effect when the surrounding form saves |
| Pick many | `CheckboxField` | Whole row toggles |
| One of 2–4 with explanations | `RadioCards` | Cards with description; `isHorizontal` goes 3-up from 672px |
| Search a list | `SearchInput` | Hidden label, placeholder is not the label, clear button once there is text |
| Weekly Availability | `components/availability-editor.tsx` | Read-only with one Edit for the whole week, one Save/Cancel |

### Filtering and views

| Need | Owner | Rules |
|---|---|---|
| Filter by a field | `components/multi-select-filter.tsx` | One per field ("Status ▾"); trigger reads "Status · 2" when on; Clear / Done |
| One-tap filter | `components/quick-filter.tsx` | `aria-pressed`; **Needs attention** (Bookings, Chats), **Unread** (Chats), **Mine** (Managers on Bookings) |
| Toolbar | `shell/page-toolbar.tsx` | Search + filters + view; "Clear all" once a filter is on |
| Sub-pages (navigation) | `components/tabs.tsx` `SubPageTabs` | Underlined, `aria-current="page"`, optional count; e.g. Chats ▸ Conversations / Reminders, Staff details ▸ Overview / Availability / Time off / Bookings / Children |
| Same data, other view | `SegmentedControl` | Sunk track, raised thumb, `aria-pressed`; e.g. List / Calendar, Week / Day |

### Lists and records

| Need | Owner | Rules |
|---|---|---|
| Office records (Families, Staff, Bookings day table) | `components/data-table.tsx` `DataTable` | Table from 768px of its own width, tappable rows below. Whole row opens the record: one stretched button, one tab stop per row, chevron on the right. `isWideOnly` columns from 1024. No buttons inside rows |
| Rich rows (sessions, time off, Child cards) | `components/list-row.tsx` `ListRow` | Card per row, stacked below 672px of its width, one line above; badges and up to a few icon details |
| Leading time | `TimeBlock` | 72px chip on Booking and Session rows |
| Detail fields | `components/detail.tsx` `DetailRow` | Icon chip + label + value |
| Child notes | `NotesCard` | Yellow card; Tutors see it with every Session |
| Person | `components/badges.tsx` `Avatar` | Initials on a pastel picked from the name; decorative (`aria-hidden`), the name is always beside it |

### Overlays (`kit/overlays/`)

| Need | Owner | When |
|---|---|---|
| A record's details and its actions | `DetailOverlay` (`phoneMode="page"`) | Opening a Booking, Session, Child, Guardian, Staff member, Time off request, chat from To do. Phone: full-screen page pushed from the right with "← {back label}". From 672px: 440px slide-over on the right. Actions live in its footer. Stacks (Child → Guardian) step back with `onBack`. `isHeaderPinned` for long content (threads, Bookings) |
| A short task or picker | `BottomSheet` | Add/edit forms (Add guardian, Add home, Time off request, Mark Evaluated, Assigned Tutors), More menu, action lists. Phone: bottom sheet up to 88% tall with grab handle. From 672px: centred 480px card. Footer: Cancel (`outline`/`ghost`) then the commit (`primary`) |
| Ask before a destructive act | `ConfirmDialog` (`isDestructive`) | Only the destructive acts in the §11.6 rule: Cancel booking, Archive (Child, Guardian, Staff, Home), Cancel time off, deleting chat history. No Undo after them. Both buttons name the act ("Cancel booking" / "Keep booking"); never OK/Cancel. `role="alertdialog"` |
| A non-destructive decision that acts on a colleague | `ConfirmDialog` without `isDestructive` | Only Take over from a colleague ("Take over" / "Leave it with Daniela") |
| Transient result | `useToast().showToast` (`overlays/use-toast.ts`) | §11.6 |

Kit rules every overlay keeps (do not re-implement): portal to the kit root's overlay host,
focus moves in on open and returns to the opener on close, Tab is trapped, Escape closes only
the top overlay, everything below is `inert` + `aria-hidden`, page scroll locks in place.

### States (`kit/states/states.tsx`)

`EmptyState`, `ErrorState`, `InlineError`, `PermissionState`, `OfflineBanner`, `Skeleton`,
`ListSkeleton`, `TableSkeleton` (§12).

### Prototype components to promote into the kit before building

These are approved patterns but live in area folders. Building tickets move them into the kit
rather than re-create them: `auth/components/password-field.tsx`, `form-alert.tsx`,
`logo-medallion.tsx`, `layout/split-layout.tsx`; `home/components/todo-card.tsx`;
`settings/components/save-bar.tsx`, `section-index.tsx`, `field-frame.tsx` (adds a "Changed"
tag; the kit's `FieldShell` is not exported); `bookings/components/time-grid.tsx`;
`accounts-staff/components/booking-block.tsx`, `lib/child-tones.ts`; `chats/components/chat-badges.tsx`
(window cue only; the holder badge is the kit's `ChatHandlerBadge`). The two local `TimeOffStatusBadge`s are replaced by the kit's `TimeOffBadge` with Expired.

## 11. Patterns

### 11.1 Page anatomy
`AppShell` → `PageHeader` (title, one primary action, tabs, toolbar) → content → states. One `h1` per page.

### 11.2 To do groups (Home)
`home/components/todo-card.tsx`. Groups in order **Chats · Bookings · Time off** (Managers: Chats
and their Bookings). Each card: 40px tinted icon chip, Lato card title, pink `CountBadge` of what's
waiting, **up to 3 rows**, then "See all {n}". Rows open the item's details only: **no buttons in
rows**; every action (Approve, Decline, Mark done, Change booking) is in the details. Loading:
three two-bar row skeletons inside the card. Empty: an "All clear" well with a check and a hint.
Error: a danger well inside the card with its own Try again (never the page `ErrorState`).
Chats' See all goes to Chats; Bookings' See all lands on Bookings with **Needs attention** on.

### 11.3 Needs attention
A `QuickFilter` with the alert icon on Bookings and Chats. On a Booking's details a "Needs
attention" block names each reason (Not marked, Staff is off, Staff archived, Needs a Tutor) with its
icon and `warning` tone; in lists the same reasons are warning badges (`bookings/components/booking-badges.tsx`).

### 11.4 Details hold the actions
Every act on a record is in its `DetailOverlay` footer or body, primary act first. Phone: footer
buttons stack full width. A destructive trigger is `danger-outline`.

### 11.5 Forms
In a `BottomSheet` (short) or a page (Settings). Validate on submit and on blur after the first
submit; errors under the field (§12.3). Booking forms show free times as chips and warnings in
place, never a blocking dialog. Settings: one page, a jump list, **one** floating Save bar that counts
unsaved changes and a "Changed" tag per field; emails save in their own editor.

### 11.6 Feedback ladder

**The confirm-or-Undo rule (Franklin, 2026-10-16).** An act is either *reversible* or *destructive*, never both:

- **Reversible acts run at once, with no confirm, and toast with Undo:** Completed, Didn't happen,
  Mark done, Keep over Time off, Approve time off, Decline time off, Hand back. This applies wherever
  the act appears (Home, Bookings, Chats, Time off, details). Time off decisions send after the Undo window.
- **Destructive acts confirm first and have no Undo:** Cancel booking, Archive (Child, Guardian,
  Staff, Home), Cancel time off, deleting chat history. `ConfirmDialog` with `isDestructive`, then a
  plain success toast. Restore, where it exists, is a separate act on the record.
- **One exception:** Take over from a colleague keeps a non-destructive confirm, because it acts on someone else's chat.

| Situation | Feedback |
|---|---|
| The change is visible where the person is | Update in place; no toast |
| Done, effect elsewhere or overlay closed | Success toast naming what happened ("Booked Emma with Ana, Thu Oct 15 at 3:30 PM.") with an optional `actionLabel` that goes there ("Open", "Open chat") |
| Reversible act | Do it at once, success toast with **Undo** (8s), per the rule above |
| Destructive act | `ConfirmDialog` first, then a success toast with no Undo |
| The office must follow up | Say so in the toast: "Booking changed. Let Diana know." + "Open chat" |
| Failure while the surface is still open | Inline: field error, `FormAlert`, or a `role="alert"` line by the button |
| Failure after the surface closed | Error toast (`tone: "error"`, `role="alert"`) saying what didn't happen and what to do |

Toasts: inverse card, tone icon chip, message, optional action, Dismiss. 5s, 8s with an action, max 3.
Bottom-centre above the tab bar on phones, bottom-right (400px) from 1024.

### 11.7 Week calendars
Bookings opens on **Calendar** (#227). Bookings: Calendar week (column per day) and Day (column per Staff member, Availability shaded,
Time off noted) from 768px; a day agenda under a 7-day strip on phones. Empty hours are buttons
that start a New booking there. Family week: Monday–Sunday, opens on this week, 7-day grid from
768px, day-by-day list below, "This week" button, Child legend. Colours in §2.4. Neighbouring weeks preload.

### 11.8 Chats
Layout A: list and thread side by side from `@6xl` (1152px kit width), otherwise the thread pushes in
as a page. Needs attention chats sort first. Thread header pins; reply window cue counts down
("Takeover closes in 5h").

### 11.9 Auth frame
Brand panel (`auth/components/layout/split-layout.tsx`): light-blue gradient panel with the logo
medallion and the site's line beside an open 400px form from 1024px; a short band on top below
that. One `h1`; `FormAlert` above the submit for whole-form problems; lockout shows the wait.

## 12. States

Every surface and every async action designs all four: loading, empty, error, success.

### 12.1 Loading
- **Structural skeletons only**, shaped like the content: `ListSkeleton` (row cards), `TableSkeleton`
  (real column count), card-local bar skeletons (To do), Settings card skeletons. No spinners for
  page or card loads, no "Loading…" text on screen.
- Skeleton look: `.kit-skeleton` shimmer (`skeleton` → `surface-sunk`, 1.4s), `rounded-full` bars,
  heights matching the text they replace (16px for 15px text, 12px for captions, 28px for badges).
- The container has `role="status"` + `aria-label="Loading {thing}"` (or `aria-busy` on a
  section). Reserve the final height; swap in without a fade.
- Buttons: `isLoading` (spinner icon, disabled, `aria-busy`), label unchanged or "Saving…".
- Nav counts: no badges until counts arrive (`counts={null}`).
- Background refetches (Home every 60s and on focus) keep content and show "Updated 1:10 PM".

### 12.2 Empty
- Page or list: `EmptyState`: 64px tinted icon disc, Lato light title (no full stop) and at most
  one plain sentence. No teaching copy and no action button (#246); the page's own header actions
  stay where they are. Pick the tone by area
  (primary default, pink for Evaluation, green for availability).
- Three copy cases: nothing yet ("No chats yet"), search/filter ("No bookings match" + "Try another
  name, or clear the filters…"), queue done ("Nothing needs attention", "All clear").
- Inside a card: a `surface-sunk` well, not a nested card.

### 12.3 Error
- Whole page failed: `ErrorState` (`role="alert"`, danger disc, title, body, primary Try again).
- One card or panel failed: `InlineError` or the To do card well, with its own Try again; the rest of the page stays.
- Field: `error` prop (icon + text under the field, `aria-invalid`, danger border).
- Whole form: `FormAlert` above the submit.
- Offline: `OfflineBanner` above the content; data stays visible.
- No access: `PermissionState` (yellow lock) with a way back.
- Never show codes, stack traces or raw API keys.

### 12.4 Missing values
Em dash `—` for an optional empty field. A field people expect filled gets a named phrase in the
value's own style: Overall grade "Grade not set", Subject level "No level yet", "No Children yet".
Optional form fields say "(optional)" only when most fields are required; otherwise required ones say "(required)".

### 12.5 Success
Update in place; overlays close on success; toasts per §11.6.

## 13. Motion

CSS and the Web Animations API only; animate `transform` and `opacity` (colour for hovers). No motion libraries.

| Token | Value | Use |
|---|---|---|
| Colour/hover | `transition-colors duration-150` | Every interactive surface, border and fill |
| Small transforms | `duration-150` | Chevron nudge on row hover (`group-hover:translate-x-0.5`), dropdown chevron rotate, switch thumb |
| `kit-fade` | 180ms ease-out | Scrims, `FormAlert` appearing |
| `kit-rise` | 220ms `cubic-bezier(0.2,0.8,0.2,1)`, 8px up | New in-flow content, `Combobox` listbox |
| `kit-pop` | 200ms same curve, scale 0.96 → 1 | Small reveals |
| Overlay enter | 260ms same curve, WAAPI (`overlays/use-enter-animation.ts`) | `PUSH_FROM_RIGHT` (phone page / wide slide-over: 32px + fade), `RISE_AS_SHEET`, `SHEET_OR_POP` (sheet up on phone, pop on wide), `POP` (dialog), `RISE` (popovers, toasts) |
| Exit | **160ms**, `cubic-bezier(0.4,0,1,1)` (ease-in), WAAPI | The reverse of the element's own enter keyframes, then unmount: overlays (`DetailOverlay`, `BottomSheet`, `Dialog`), popovers (`Select`, `MultiSelectFilter`, `Combobox`), sheets, toasts. The scrim fades out over the same 160ms |
| Skeleton | 1.4s ease-in-out infinite shimmer | `.kit-skeleton` |
| Spinner | 0.9s linear | `.kit-spin` in loading buttons |

- **Exits are faster than enters (Franklin, 2026-10-16):** every exit plays a 160ms reverse of its
  enter, never longer. While it plays, the closing layer is already out of the overlay stack
  (`inert`, no keys) and focus has returned to the opener, so an exit never blocks the next action.
  The kit's overlays, popovers and toasts get this before the build (today they unmount instantly).
- `prefers-reduced-motion`: enters **and exits** switch off (instant mount and unmount), as do the
  kit keyframes. New motion must do the same (`motion-reduce:` utilities, the `kit.css` media block,
  or the WAAPI check in `use-enter-animation.ts`). Smooth `scrollIntoView` must check it too.
- Pressed feedback: `Button`, `IconButton`, `DataTable` rows, phone rows and `ListRow` get an
  `active:` fill one step darker (`tint` → `tint-strong`, `primary` → `primary-hover`,
  `danger` → `danger-hover`), as options and checkboxes already have.
- No motion on page navigation or tab switches beyond colour.

## 14. Accessibility

- **Contrast:** text ≥ 4.5:1 (all tone pairs and `muted` on `canvas`/`surface`/`tint` pass in both
  themes); field outlines and focus ≥ 3:1. Never `hero` or pastel fills as text colour on light.
- **Focus:** one ring everywhere: `outline: 2px solid var(--tl-focus); outline-offset: 2px` on
  `:focus-visible` (`kit/kit.css`). Inside clipped lists (options, table rows, phone rows) the
  offset is −2px. Never remove it.
- **Targets:** every control is at least 44×44 (buttons, fields, rows, options, pills, tabs,
  `TextLink`, toast actions). Spacing between adjacent targets ≥ 8px.
- **Colour is never alone:** statuses carry a word plus a dot or icon; calendar blocks carry text;
  cancelled is struck through and named.
- **Names:** icon buttons need `label`; counts carry an `sr-only` noun ("7 unread"); avatars and icons are `aria-hidden`.
- **Semantics:** one `h1`; tables with `caption` and `th scope`; nav with `aria-current="page"`;
  toggles with `aria-pressed`; tabs-as-navigation with `aria-current`; listboxes per ARIA combobox
  pattern (`select.tsx`, `combobox.tsx`); errors linked by `aria-describedby`.
- **Live regions:** success/info toasts `role="status"`, error toasts and error states `role="alert"`;
  week ranges and result counts `aria-live="polite"`.
- **Overlays:** the kit's modality (§10) is required; do not use native `<dialog>` or Radix in redesigned UI.
- **Forms:** visible labels, never placeholder-only; paste never blocked; autocomplete set on auth fields.
- **Zoom:** layouts survive 200% text zoom and 320px width without horizontal scroll.

## 15. Copy and voice

### 15.1 Vocabulary (from `CONTEXT.md`; it wins on any conflict)

| Say | Never say |
|---|---|
| Booking (Office screens) · Session (Tutor screens, "My sessions") | Appointment, lesson, class; Session on Office screens; Booking on Tutor screens |
| Guardian · Child · Family / Families | Client, parent, user, student, kid, **Account(s)**, household |
| Staff · Tutor · Manager · Admin · the office | Employee, team, users, back office |
| Tutoring · Evaluation (session) | Regular, trial, assessment |
| Pending · Confirmed · Completed · Didn't happen · Cancelled | No-show, missed |
| Change booking (office) · Reschedule (Guardian, bot) | Edit booking |
| Time off · Approve / Decline / Cancel · Expired | Exception, leave, reject, withdraw, delete |
| Availability · Home visits / Home or office / Office only | Schedule, shifts |
| Archive / Restore | Deactivate, inactive, delete |
| Taken over (by …) · Takeover · Hand back · Bot | Escalation, human, held, transfer, release |
| Needs attention (+ reason) · Mark done · Unread | Flag, flagged, handled, parse error, new messages |
| To do (Home's queue) · Home | Inbox, tasks, alerts, Dashboard; "To sort out" anywhere in the UI |
| Assigned Tutors · Subject level · Overall grade · Child notes · Directions | Preferred tutor, grade level, office notes, access code |
| Not invited / Invited / Active · Invite · Sign in | No login, activated, log in |
| Reminders on / Reminders off / Never asked · Send Booking reminders | Unsubscribe, opted out |

### 15.2 Rules
- Sentence case everywhere except the eyebrow and table headers (uppercase by style, typed in sentence case).
- Titles, buttons, badges and labels: no full stop. Body text, help, toasts: full sentences with full stops.
- Curly apostrophes and quotes in UI copy (`’`, `“ ”`); en dash for ranges ("3:00 PM – 4:00 PM", "Oct 12 – 18").
- Buttons are verb + noun and name the act: "Cancel booking", "Add guardian", "Mark Evaluated", "Approve time off". Confirm pairs name both sides: "Cancel booking" / "Keep booking", "Decline time off" / "Keep it pending".
- Toasts say what happened, then what's next: "Approved Marco's time off. 2 Bookings to change, now in To do."
- Errors say what failed and what to do, never blame: title "Couldn’t load {thing}", body "Check your connection and try again." One pattern in every area.
- Empty states are a plain message: what isn't there, nothing more.
- Help is inline only: hints under tricky fields and "?" tooltips on rules; no Help page. Each role
  sees a short welcome card on its landing page once, until dismissed. Staff copy is English only.
- Counts in words where space allows ("See all 7", "2 Bookings in these dates"); `pluralize()` from `kit/format.ts`.
- Dates and times: business time zone (America/New_York, fixed), US format: "Thu, Oct 15", "3:30 PM", "Today", "Tomorrow" (`kit/format.ts`). First names in tight spaces (calendar blocks, badges), full names in titles.
- Spanish and English are Guardian languages for the bot; dashboard copy is English.

## 16. Building from the kit (decided, Franklin 2026-10-16)

The redesign ships big bang, on this setup:

1. **Kit location.** The kit moves to `dashboard/src/components/kit/`, keeping its file layout
   (`tokens.ts`, `kit.css`, `components/`, `overlays/`, `shell/`, `states/`, `hooks/`, `lib/`). The
   prototype components listed in §10 are promoted into it. `components/ui/*` (shadcn) and the old
   `components/shared/*` primitives are retired, never mixed into redesigned screens.
2. **Tokens.** `tokens.ts` stays the single source, with the `--tl-*` names and the
   `bg-(--tl-x)` class syntax, so kit code ports unchanged. They are set on the app root (as
   `KitRoot` does today, or as CSS generated from `tokens.ts`); the old shadcn variables in `index.css` go.
3. **Theme.** Follows the OS by default; Profile offers Light / Dark / System, stored per device.
   The root carries `data-theme` and `color-scheme`.
4. **Fonts.** Self-hosted via `@fontsource`: Lato 300 and 700, Inter variable. Geist and the
   Google Fonts `<link>` in `kit-root.tsx` are removed.

Prototype-only scaffolding never ships: `DeviceFrame`, `PrototypeSwitcher`, `PrototypeNote`,
`WireNote`, `OpenQuestion` chips, "Prototype:" toasts, mock data.

## 17. Known prototype drift (the build follows this document)

The prototypes show these differently. Build tickets follow the rule on the right; reviewers flag
any copy of the prototype behaviour.

| # | Prototype drift | The build does |
|---|---|---|
| 1 | Mark done (Home, Chats), Approve time off (Home, Time off) and Home's booking outcomes toast with no Undo | Undo on every reversible act (§11.6) |
| 2 | Kit lacks Didn't happen (Bookings shows "Cancelled, didn't happen"), Expired (two local badges) and Reply window closed | Add to the kit: Didn't happen neutral + CircleSlash, Expired neutral + Hourglass, Reply window closed warning + Clock (§2.3); delete the local badges |
| 3 | Decline time off and Hand back confirm; Archive Staff / Home confirm *and* offer Undo | Decline time off and Hand back: instant with Undo. Cancel booking and Archive: confirm, no Undo. Take over keeps its confirm (§11.6) |
| 4 | `child-tones.ts` cycles `index % 4`, so a fifth Child repeats blue | From the fifth Child, neutral blocks named by first name (§2.4) |
| 5 | Overlays, popovers, sheets and toasts unmount instantly | 160ms reverse of the enter; none under reduced motion (§13) |
| 6 | Cancelled blocks: hatched (visual direction), dashed + 60% opacity (Bookings grid), sunk + struck (family week) | One style: sunk fill, muted text, strike-through, "Cancelled" (§2.4) |
| 7 | "Chats didn't load", "Bookings didn't load … Something went wrong on our side", mixed apostrophes | "Couldn’t load {thing}" + "Check your connection and try again."; curly apostrophes (§15.2) |
| 8 | Chats splits list and thread at 860px of page width in JS | Split from `@6xl` (1152px kit width) (§8, §11.8) |
| 9 | 11px text in `home/components/booking-todo-row.tsx`, `bookings/components/time-grid.tsx`, `settings/components/field-frame.tsx` | 12px minimum |
| 10 | `hover:shadow-md` / `hover:brightness-95` on calendar blocks; radii 10, 22, 24px; `settings/lib/control-classes.ts` duplicates the kit; `Combobox` and `PasswordField` hand-roll field classes | `shadow-raised` on hover; radii 14, 20, 28px; one `getControlClasses` for every field |
| 11 | `Combobox` is an in-flow dropdown at every width | Bottom sheet with the search on top below 672px (§10) |
| 12 | `Button`, `IconButton`, `DataTable` rows and `ListRow` have no pressed state | `active:` fill one step darker (§13) |
| 13 | Bookings opens on List | Opens on Calendar (§11.7) |
| 14 | `chats/components/chat-badges.tsx` redraws the holder badge | Use the kit's `ChatHandlerBadge` ("Taken over by Maria" / "by you") |
| 15 | Chats filter "Handled by"; wire `rejected` | Filter reads "With"; `rejected` always shows as Declined. The short badge "Never asked" stays |

## 18. What changed from the 2026-10-01 version

Dropped: indigo hue 264, Geist, shadcn token names and `components/ui` owners, `StatusBadge`
tone keys, `SlideOver` / `SegmentedTabs` / `Toaster` text-only toasts, "errors are never toasts",
the 32px control sizes and R1 grandfathering (every kit control is 44px), the `md` 768 viewport
breakpoint as the main switch, and the legacy "Loading…" + pulse bars. Kept: content-shaped
skeletons (R2) that reserve height, the em dash and named-phrase rules for missing values,
sentence case and full-stop rules, one tab stop per clickable row, colour never alone, motion
only on transform/opacity with reduced-motion respected.
