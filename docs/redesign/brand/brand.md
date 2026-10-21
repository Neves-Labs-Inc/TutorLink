# M's Helping Hands brand (from the public site)

Extracted 2026-10-13 for the dashboard redesign. **[read]** = read verbatim from the site's
HTML/CSS. **[inferred]** = my reading or a sampled value, not declared anywhere.

Note: the business writes its name **M's Helping Hands** (wordmark: `M'S HELPING HANDS`;
legal: "M's Helping Hands LLC"), not "Ms. Helping Hands". **[read]**

## Sources

- https://mshelpinghandss.com/ (double "s" in the domain). It is a one-page React app
  (HashRouter, single `/` route), so the homepage is the whole site: hero, services, about,
  gallery, testimonials, FAQ, contact form. **[read]**
- Builder: **SiteJourney.ai** (footer "Made with SiteJourney.ai", assets on
  `api.sitejourney.ai`, Supabase form backend). Styling is Tailwind via the Play CDN with an
  inline `tailwind.config`. **[read]**
- Logo: `https://api.sitejourney.ai/storage/v1/object/public/site-assets/bb32b4e4-3296-407d-998d-23e813314604/pending-1783866592708/logo.JPG` **[read]**
- Instagram: https://www.instagram.com/ms.helpinghands (not fetched).

## Logo files

| File | Format | Notes |
|---|---|---|
| [assets/logo.jpg](assets/logo.jpg) | JPEG, 768×764, white background | The only logo the site uses (`h-12 w-auto` in header and footer, next to a text wordmark). Hand-drawn style: two tan line-art hands cradling a heart, pencil and books inside a circular tan ring; lettering "M'S HELPING HANDS" and "BABYSITTER AND TUTOR" around it in teal, mauve and sage. **[read]** |

- No favicon: `/favicon.ico` returns 404 and the HTML has no `<link rel="icon">`. **[read]**
- No SVG or transparent PNG exists. The fine line art and small lettering do not survive
  below ~48px; a small-size mark (hands + heart only) would need redrawing. **[inferred]**

## Colour palette

The site's Tailwind config declares four pastel families. **[read]**

| Hex | Token on site | Role | Where seen |
|---|---|---|---|
| `#ADD8E6` | `lightBlue` | **Primary** (CTA fill, accents) | All buttons (`bg-lightBlue rounded-full`), stat numbers, icon chips, social-icon hover |
| `#E8F4F8` | `lightBlue-50` | Tinted section background | Alternating section bands, cards, eyebrow pills (10 uses, most-used brand class) |
| `#B8E6F2` | `lightBlue-100` | Light blue tint | Declared; not seen in markup |
| `#FFC0CB` | `lightPink` | Secondary accent | Small icons/highlights (4 uses) |
| `#FFE5EC` | `lightPink-50` | Pink tint | Declared |
| `#FFB3D9` | `lightPink-100` | Pink tint | Declared |
| `#FFFFE0` | `lightYellow` | Tertiary accent | Star/quote icons (3 uses) |
| `#FFFFF0` / `#FFFACD` | `lightYellow-50/100` | Yellow tints | Declared |
| `#90EE90` | `lightGreen` | Declared accent | Not seen in markup |
| `#E8F8E8` / `#B8F0B8` | `lightGreen-50/100` | Green tints | Declared |

Also used, from stock Tailwind **[read]**: text `slate-900` / `slate-800` / `slate-700` /
`slate-600` and `gray-800` (body default `text-gray-800`); surfaces `white` and `slate-50`;
hero overlay `slate-900/40`; hero emphasis word in a `pink-300 → pink-200` gradient italic;
`rose-100/40` photo wash.

Logo colours (sampled from the JPEG, so approximate ±5%) **[inferred]**:

| Approx hex | Role in logo |
|---|---|
| `#DCBE96` | Warm tan: hands, ring, all line art (dominant) |
| `#8AC5C8` | Teal: "HELPING" letters |
| `#C9A3C3` | Mauve: "HANDS", "BABYSITTER" |
| `#92CB98` | Sage green: "M'S", "TUTOR" |

The logo's tan does **not** appear anywhere in the site's CSS; the site and logo palettes only
loosely agree (both pastel; teal ≈ lightBlue family). **[inferred]**

Contrast caveat **[inferred]**: `#ADD8E6` with white text (used on the hero CTA) is about 1.5:1,
and with `gray-900` text about 11.6:1. None of the brand pastels can carry white text or serve
as a text colour on white.

## Type

| Family | Weights loaded | Where used |
|---|---|---|
| **Lato** (Google Fonts) | 100–900 + italics | `--font-display`: every heading, almost always `font-thin` (100) at `text-xl`–`text-5xl`; the hero title is `font-bold uppercase tracking-tight text-5xl md:text-8xl`; the wordmark is `font-thin tracking-tight` uppercase **[read]** |
| **Inter** (Google Fonts) | 300–800 (100–900 also imported) | `--font-sans`: body, buttons (`font-medium text-sm/lg`), eyebrow pills (`font-semibold uppercase tracking-widest text-sm`) **[read]** |

The Tailwind config maps both `sans` and `display` to Inter, but the CSS `--font-display: 'Lato'`
and the `.font-display` class win, so headings render in Lato. **[read]** The signature look is
thin Lato headings. **[inferred]**

## Components and shape

- Buttons: pill (`rounded-full`), `px-6–8 py-2.5–4`, `bg-lightBlue`, `font-medium`, `shadow-lg/xl`,
  `transition-all`. Secondary hero button: glass (`bg-white/10 backdrop-blur-md border-white/30`). **[read]**
- Hover uses `hover:bg-lightBlue-200` and `text-lightBlue-300`, which the config never defines, so
  those hovers do nothing on the live site. **[read, consequence inferred]**
- Cards: `rounded-2xl`/`rounded-3xl`/`rounded-[2.5rem]`, soft `shadow-xl/2xl`, blurred lightBlue
  glow blobs behind images. Very round, very soft. **[read]**
- Icons: lucide-react and Font Awesome 6.5. **[read]**

## Imagery

Real photos of the tutors with students and kids (11 uploads plus 5 Imgur images): warm, candid,
classroom/table settings; gallery "Moments at M's Helping Hands". Hero is a full-bleed photo under
a `slate-900/40` overlay. **[read]** Hand-drawn, gentle, family-friendly feel from the logo. **[inferred]**

## Voice and tone

Warm, encouraging, parent-facing, confident about outcomes; uses "we" and "your child". Title Case
headings, exclamation marks allowed. **[read]** Representative lines **[read]**:

- "Helping Every Child Learn With Confidence"
- "Every child learns differently."
- "We don't just teach; we mentor."
- "Passionate. Experienced. Caring."
- "Safe, reliable, and engaging care for your little ones."

Services in scope: K-12 tutoring ($25+/h), babysitting ($20+/h), test prep, in person in Doral, FL
and virtual. **[read]**

## What the brand fixes

- Identity: name "M's Helping Hands", the circular hand-drawn logo (raster only).
- Primary hue: light blue `#ADD8E6` with tint `#E8F4F8`; pastel pink/yellow/green as secondary accents.
- Type pairing: Lato for headings (thin weight), Inter for UI/body text.
- Shape language: pill buttons, generously rounded cards, soft shadows.
- Mood: warm, caring, pastel, photographic, encouraging.

## What it leaves open for a product UI

- A primary shade dark enough for text, links and filled buttons with readable labels (the
  pastels fail contrast for both). A darker ramp of the blue hue would need to be derived.
- A neutral scale (the site just uses stock slate/gray).
- Status colours: success, warning, danger, info. The pastel green/yellow/pink are too light to
  be used as status text.
- Dark mode (the site has none).
- Data-dense type sizes and weights: thin Lato is a display face and will not hold up at 12–14px
  in tables. Tabular numerals, label sizes.
- Focus states (the site has none of its own), hover states (they're broken on the site), disabled states.
- Iconography rules beyond "lucide is used".
- A small-size or monochrome logo mark and a favicon.
- Product voice: the parent-facing marketing tone is not obviously right for admin/tutor microcopy.

## Compared with the current dashboard

Source: `dashboard/src/index.css` and `DESIGN.md` (§1, §2, typography). **[read]**

- **Colour: no overlap.** The dashboard is cool-gray neutrals with a single **indigo** primary,
  `oklch(0.448 0.145 264)` (≈ `#294EA4`) **[hex inferred]**, plus amber/green/red/gray status pairs
  and a violet calendar-evaluation colour. No light blue, pink, yellow or tan. DESIGN.md §1:
  "Neutral cool-gray surfaces carry a single indigo accent (hue 264)."
- **Type: no overlap.** The dashboard uses **Geist Variable** only (`font-sans` = `font-heading`,
  "There is no second font"), semibold headings. No Lato or Inter.
- **Shape: partial.** The dashboard radius is `0.625rem` (shadcn default); badges are pill
  (`rounded-full`), but buttons are not.
- **Tone: opposite by design.** DESIGN.md §1 says "quiet ... calm ... no illustrations or decorative
  gradients", with sentence-case copy; the site is warm, pastel, photographic, Title Case.
- **Logo: absent.** The dashboard has no brand logo; `dashboard/public/favicon.svg` is the Vite
  default (purple `#863bff` bolt).
- **What the dashboard already does that the brand doesn't:** WCAG-AA-measured tokens, full
  dark mode, status tokens, focus rings. A rebrand would mean re-hueing the primary/accent
  tokens and swapping fonts within that system, not replacing it.
- `docs/branding/colors.md` (untracked) exists but is empty.
