# TutorLink Dashboard Design System

Status: APPROVED by Franklin (2026-10-01).
Scope: `dashboard/` (Vite + React 19 + Tailwind v4 + shadcn `radix-nova`, lucide icons).
This file describes the dashboard as it is today. It is not a redesign. Where today's code
misses the pipeline bar, the gap is listed under "Known drift". Section 10 records Franklin's
rulings on how new work handles that drift.

## 1. Product tone

An office tool for tutoring-agency admins and tutors. It should be quiet, dense enough to scan,
and calm. Neutral cool-gray surfaces carry a single indigo accent (hue 264). Colour carries
status and little else. There are no illustrations or decorative gradients, and emoji are
never used as icons. Copy is short and plain, in sentence case, with full stops on full
sentences ("No active children.", "Something went wrong. Please try again.").

## 2. Colour tokens

All tokens live in `dashboard/src/index.css`. They are defined in `:root` (light) and
overridden twice for dark: in `.dark` and in `@media (prefers-color-scheme: dark) :root:not(.light)`.
**Any token change must be made in all three blocks.** Components use only the Tailwind
names below. They never use raw hex, `oklch()`, or Tailwind palette colours (`red-500`, `gray-*`).

| Role | Tailwind class | Use |
|---|---|---|
| Page | `bg-background` / `text-foreground` | App canvas, body text |
| Surface | `bg-card` / `text-card-foreground` | Cards, slide-overs, dialogs, chat panel |
| Popover | `bg-popover` | SearchPicker listbox |
| Primary | `bg-primary` / `text-primary-foreground` | Primary buttons, active tab, admin chat bubble, unread dot, selected-row rail |
| Secondary | `bg-secondary` / `text-secondary-foreground` | Secondary buttons, bot chat bubble |
| Muted | `bg-muted`, `text-muted-foreground` | Hover fills, client chat bubble, skeleton bars, captions, labels in `dt`, meta text, empty-state text |
| Accent | `bg-accent` / `text-accent-foreground` | Highlighted picker option |
| Destructive | `text-destructive`, `bg-destructive/10` | Error text, destructive buttons, failed message ring |
| Border / input / ring | `border-border`, `border-input`, `ring-ring/50` | Dividers, field outlines, focus rings |
| Sidebar | `bg-sidebar`, `bg-sidebar-primary`, `bg-sidebar-accent`, `border-sidebar-border` | Admin sidebar, tutor nav, mobile headers |
| Chart 1-5 | `chart-*` | Charts only |

### Status tones (badges)

There are four tone pairs, each a `-bg` fill with a matching text colour. They are used **only**
through `StatusBadge`.

| Tone | Classes | Meaning |
|---|---|---|
| pending (amber, hue 84) | `bg-status-pending-bg text-status-pending` | Waiting on someone / routine handoff |
| confirmed (green, hue 152) | `bg-status-confirmed-bg text-status-confirmed` | Good / live / bot handling |
| cancelled (red, hue 27) | `bg-status-cancelled-bg text-status-cancelled` | Stopped / failed / bot broke |
| completed (neutral, hue 264) | `bg-status-completed-bg text-status-completed` | Done / neutral / unknown key fallback |

The palette comment in `index.css` records the contrast floor: the lowest pair is 3.15:1 against a
3:1 minimum (non-text UI). Body text pairs are AA.

## 3. Typography

- Font: Geist Variable (`@fontsource-variable/geist`). `font-sans` and `font-heading` are the
  same face. There is no second font.
- Weights: `font-medium` (500) for labels, buttons, badges, and error text; `font-semibold`
  (600) for headings. Nothing heavier.
- Use `tabular-nums` for stat numbers.

| Role | Classes |
|---|---|
| Stat value | `font-heading text-3xl font-semibold tabular-nums` |
| Page title (h1) | `font-heading text-2xl font-semibold tracking-tight` |
| Section title (h2), slide-over/dialog title | `font-heading text-lg font-semibold tracking-tight` |
| Card title | `CardTitle` (`text-base font-medium`) |
| Body / table cell / control | `text-sm` (inputs are `text-base` below `md` to stop iOS zoom, `md:text-sm`) |
| Meta, captions, table headers, `dt`, badges, helper text | `text-xs` (headers and `dt` add `text-muted-foreground`) |

## 4. Spacing, radius, shadow

- Spacing uses the Tailwind 4px scale. Common values: page stack `space-y-6`, section stack
  `space-y-3`, field stack `space-y-4`, label to control `space-y-1.5`, toolbar `gap-3`/`gap-6`,
  card padding `--card-spacing` = 16px (`size="sm"`: 12px), table cell `px-4 py-3`.
- Page container (AppShell): `max-w-6xl px-4 py-6 sm:px-6 lg:px-8`.
- Radius: base `--radius: 0.625rem` (10px).
  - `rounded-lg` (10px): buttons, inputs, skeleton bars, chat bubbles, dialogs.
  - `rounded-xl` (14px): cards.
  - `rounded-full`: badges and the unread dot.
  - `rounded-md`: tab pills.
- Shadow is rare. Cards use `ring-1 ring-foreground/10`, not a shadow. The two shadows in use
  are `shadow-md` on the picker listbox and `shadow-xl` on the mobile nav drawer.

## 5. Component inventory (owners)

Reuse these before writing anything new. A new primitive is a decision for Franklin.

| Need | Owner |
|---|---|
| Button / link-styled button | `components/ui/button.tsx`, variants `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `default` (h-8), `sm` (h-7), `xs`, `lg` (h-9), `icon*` |
| Text field / select / textarea / label | `components/ui/input.tsx`, `select.tsx` (native select + chevron), `textarea.tsx`, `label.tsx` |
| Surface | `components/ui/card.tsx` (`Card`, `CardHeader`, `CardTitle`, `CardAction`, `CardContent`, `CardFooter`) |
| Lists of records (all states) | `components/shared/DataTable.tsx`: table at `md+`, stacked cards below `md`; owns loading, error, and empty |
| Pagination | `components/shared/Pager.tsx` |
| Status / flag / role chip | `components/shared/StatusBadge.tsx` |
| Create / edit form panel | `components/shared/SlideOver.tsx` (Radix Dialog; full-screen on mobile, right panel `sm:max-w-md`) |
| Confirm an action | `components/shared/ConfirmDialog.tsx` (focuses Cancel; `destructive` prop; `pending` shows "Working…") |
| Async search select | `components/pickers/SearchPicker.tsx` (label + muted `description` line per option) |
| Chat bubbles | `components/chat/MessageThread.tsx` |
| App chrome | `components/layout/AppShell.tsx`, `AdminSidebar.tsx`, `TutorNav.tsx` |

There is no toast primitive. Feedback is inline: errors render as `role="alert"` text next to
the action that failed, and success shows as the updated UI (the slide-over closes, the row
changes).

### StatusBadge

`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap` plus
a tone from section 2. The label is the key with underscores turned into spaces and the first
letter capitalised (`guardian_link_request` becomes "Guardian link request"). An unmapped key
falls back to the neutral `completed` tone, so **every new status key must be added to
`TONE_CLASSES`** on purpose.

Current mapping:

| Tone | Keys |
|---|---|
| confirmed | `confirmed`, `approved`, `active`, `bot` |
| pending | `pending`, `guardian_link_request`, `reactivation_request` |
| cancelled | `cancelled`, `rejected`, `inactive`, `stuck`, `parse_error` |
| completed | `completed`, `human` |

**Flag-reason rule.** The tone depends on whether the reason is a bot failure:
- A **bot failure** (`stuck`, `parse_error`) uses the `cancelled` tone, and `isErrorFlag` returns true.
- A **routine handoff** (the bot is working as designed and passing the chat to the office) uses
  the `pending` tone, and `isErrorFlag` returns false. Today that means `guardian_link_request`
  and `reactivation_request`. Upcoming `booking_request` ("Booking request") and `question`
  ("Question") belong here.

Flag badges appear in two places: the conversation list cell (after the bot/human badge, in a
`flex flex-wrap gap-1.5` row) and the chat thread header (after the h1, before "Mark handled",
in a `flex flex-wrap items-center gap-3` row). Both wrap, never truncate.

## 6. States

### Loading
**Rule (Franklin, 2026-10-01):** any new surface, and any surface a ticket touches, uses
content-shaped skeletons (see section 10). The pattern described below is the legacy one. It
stays on untouched surfaces until they are next touched.

The legacy pattern, used by DataTable, ChatThread, and ChildDetail, is a muted "Loading…"
line (`text-sm text-muted-foreground`; the copy names the thing, as in "Loading child…" or
"Loading conversation…") above four `h-8 animate-pulse rounded-lg bg-muted` bars, inside a
`Card` (or bare in the chat panel), with `aria-busy="true"`. Buttons show progress in their
label: "Taking over…", "Marking…", "Working…", "Loading…". The button is disabled while it
waits. SearchPicker shows "Searching…".

### Empty
Show one muted sentence in a `Card` (`text-sm text-muted-foreground`). The copy depends on
context:
- `No <things> yet.` when there is no data at all.
- `No <things> match that search.` when a search is active.
- `No inactive <things>.` when a filter is active.

Inline empty lists inside a card use the bare phrase "No children" (no full stop).

### Missing values (null fields)
- A generic optional field shows an em dash `—` in the cell's normal text style. Examples:
  notes, description, guardians, homes.
- A field that the user would expect to be filled, but is not yet, gets **a named phrase
  instead of the dash**, styled exactly like the value it replaces. For grade this is
  **"Grade not set"**, used everywhere "Grade {n}" appears today:
  - the Children table cell;
  - ChildDetail `DetailField`;
  - the Guardians card line (already `text-sm text-muted-foreground`);
  - the GuardianChildrenSection cell;
  - the SearchPicker description ("Grade not set · inactive").

  No italics, no badge, no extra colour.
- Optional form fields say so in the label: `Notes (optional)`. A field that becomes optional
  follows the same pattern, for example `Grade level (optional)`.

### Error
- Load errors: `role="alert"` `text-sm font-medium text-destructive` with the API `detail` or the
  fallback "Something went wrong. Please try again.", followed by an `outline` "Try again" button.
  A 404 shows its own message and no retry.
- Form errors: a list or paragraph with `role="alert"` above the slide-over footer, plus
  `aria-invalid` on the field (the primitives already style `aria-invalid`).
- Action errors: a `role="alert"` line directly under the button, with action-specific fallback
  copy ("Could not mark this conversation handled.").
- Failed chat message: `ring-2 ring-destructive` on the bubble plus a destructive status label.

### Success
The UI updates in place (query invalidation). Slide-overs close on success, and there is no
toast.

## 7. Interaction and motion

- **Focus-visible.** Controls use `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`
  (primitives), or `focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`
  (hand-rolled icon buttons and nav links). Text links use `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.
  The base layer sets `outline-ring/50` on everything.
- **Hover.** Buttons and rows get a fill: `hover:bg-muted`, or `hover:bg-primary/80` for primary
  buttons. Nav uses `hover:bg-sidebar-accent`. Links use `hover:underline` or `hover:text-foreground`.
- **Press.** Buttons use `active:translate-y-px` (built into `buttonVariants`).
- **Disabled.** `disabled:opacity-50 disabled:pointer-events-none`.
- **Colour changes.** `transition-colors` at the Tailwind default (150ms).
- **Overlays.** Dialogs and slide-overs use `tw-animate-css` enter/exit on Radix
  `data-[state]`. The overlay fades. ConfirmDialog fades and zooms 95%. SlideOver fades and
  slides in from the right. All of them set `motion-reduce:animate-none`.
- **Mobile nav drawer.** `transition-transform duration-200 ease-out`, with the backdrop on
  `transition-opacity duration-200 ease-out` and `motion-reduce:transition-none`.
- **Rules for new work.** Motion is CSS only. Animate `transform` and `opacity`. Durations
  are 150ms for colour and 200ms for panels. Easing is `ease-out`. Always add `motion-reduce:`.

## 8. Responsive

- Design mobile-first at 375px. Breakpoints are Tailwind defaults: `sm` 640, `md` 768
  (sidebar and table layouts appear), `lg` 1024.
- Below `md`, the admin layout has a sticky 56px header with a menu button that opens a
  drawer. The tutor layout has a bottom tab bar with safe-area padding.
- Below `md`, DataTable renders each row as a `Card` with a `dl` of `header: value` pairs.
  Columns can opt out with `hideOnMobile`. The first column is the card title.
- Toolbars use `flex flex-wrap` so they reflow instead of scrolling. The table body is the only
  place that scrolls horizontally (`overflow-x-auto`, `md+`).
- Chat panel height is `h-[calc(100dvh-14rem)] min-h-[24rem]`. Bubbles are `max-w-[85%] sm:max-w-[70%]`.

## 9. Known drift (documented, not yet fixed)

1. **Touch targets under 44px.** Button `default`/`sm` are 32px and 28px. Inputs are 32px.
   The SearchPicker clear button is 20px. Only the nav icon buttons (`size-10`, 40px) come close.
   These are grandfathered under R1 until a cleanup ticket fixes them.
2. **Loading is not structural.** The pulse bars are generic, not shaped like the content.
   R2 replaces them surface by surface as tickets touch them.
3. **Clickable rows are mouse-only.** The DataTable `<tr onClick>` and mobile `Card onClick` have
   no keyboard access, focus ring, or pressed state. Mobile cards have no hover or press feedback.
4. **Hand-rolled tabs.** The ChildDetail session tabs are buttons with no focus-visible style.
   The inactive tab has no hover fill.
5. **Two backdrop colours.** Dialogs use `bg-black/60`; the nav drawer uses `bg-foreground/60`.
6. **Exits as slow as enters.** The tw-animate defaults use the same duration both ways.
7. **Commented-out code.** `DataTable` has a `PrimaryCell` comment.
8. **Duplicated dark tokens.** Dark values are copied into two blocks, so it is easy to update one and miss the other.
9. `text-[0.8rem]` in Button `sm` (shadcn upstream; leave it).

## 10. Rulings for new work (Franklin, 2026-10-01)

### R1. Touch targets
- **New** interactive controls must have a hit area of at least 44x44px below `md`. Get
  there with height (`h-11 md:h-8` on Button/Input) or by padding the hit area
  (`min-h-11 min-w-11` on an icon button). Above `md` they may use the existing desktop sizes.
- **Existing** controls keep their current size, even on a screen a ticket edits. Drift item 1
  goes to a later cleanup ticket. A design review does not raise existing controls under 44px
  as findings.

### R2. Content-shaped skeletons
- A new or touched surface's loading state is a skeleton that matches the shape of the
  content it replaces, not "Loading…" above generic bars.
  - **Table / list:** a skeleton with the real column count. Below `md`, skeleton cards that
    have the same layout as the mobile `dl` rows: a title bar, then 2-4 label/value bar pairs.
  - **Detail card:** a skeleton `CardTitle` bar, then `dt`/`dd` bar pairs in the same `grid sm:grid-cols-2`.
  - **Chat thread:** alternating left and right bubble-shaped bars.
- Skeleton tokens: `bg-muted`, `animate-pulse`, `motion-reduce:animate-none`. Use `rounded-lg`
  for blocks and `rounded-full` for badges. Bar heights follow the text they stand in for:
  `h-4` for text-sm, `h-3` for text-xs, `h-5` for badges.
- The container keeps `aria-busy="true"` and a hidden `sr-only` "Loading <thing>…" so screen
  readers still hear the status.
- The skeleton must reserve the same height as the content to avoid layout shift. Swap it
  in without a fade.
- **Scope (Franklin, 2026-10-01):** a ticket that only changes the text inside a value (copy,
  formatting, a new label) is not "touching" the surface, and R2 does not apply. R2 applies when a
  ticket builds a surface or changes its layout or states. The shared `DataTable` skeleton is
  tracked in `.scratch/bot-conversation/issues/09-datatable-skeleton.md`.
