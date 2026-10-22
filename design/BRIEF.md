# Diktatorn design brief

The design decisions every screen follows. The values live in [`src/renderer/tokens.css`](../src/renderer/tokens.css), which every window loads; this file explains how to use them. If the two disagree, fix one of them.

## The product

Diktatorn turns speech into text in any Mac app, locally, with Swedish first. You hold a key, talk and release, and the text appears where you were typing. Most of the interface is barely seen: a pill at the bottom of the screen while you talk, and an icon in the menu bar. The app window is for setting up, checking status and changing settings.

## Personality

Friendly, calm and quick. The name is a joke on "dictator", and the product is the opposite of one: it listens and does what you say.

- **Do:** rounded shapes, the lowercase wordmark, plain and warm language, and the bright brand gradient, used sparingly.
- **Don't:** anything that commands or shouts. No megaphones, crowns, uniforms, alarm red, all-caps headings or exclamation marks.

## Principles, in priority order

1. **Out of the way.** Dictation happens in other apps. Diktatorn never takes focus from the text field, never delays the first word and never makes you wait for an animation.
2. **State you can trust.** Whether it is listening, transcribing, done or stuck is always visible, immediately, in words as well as colour.
3. **Native first.** The system font and macOS text styles, light and dark mode, the sidebar window layout, full keyboard access, and the accessibility settings: Reduce Motion, Reduce Transparency and Increase Contrast.
4. **Simple, not minimal.** Show the common path first and keep advanced choices one level deeper. Add a line of context when it saves the user a question.
5. **Craft.** Every value comes from a token. A value that isn't on a scale needs a reason.

## Surfaces

| Surface | How often it's seen | Job | Bar |
| --- | --- | --- | --- |
| Overlay pill | Every dictation, 100+ times a day | Shows the dictation state | Highest: instant, and legible on any background |
| Menu bar icon | Always | Presence and the menu | Template image, crisp at 18 pt |
| App window | A few times a week | Status, settings, dictionary, models | Apple-quality polish |
| First run and onboarding | Once | Downloads and permissions | Can carry some delight |
| Debug window | Developers only | Diagnostics | Tokens for colour and type; no polish bar |

## Colour

The palette is Rozeno Digital's. Don't add colours outside it.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F4F7FA` | `#0B0F19` | Window background |
| `--sidebar` | `#FFFFFF` | `#090D16` | Sidebar |
| `--card` | `#FFFFFF` | `#0F1421` | Groups, cards, rows |
| `--surface2` / `--surface3` | `#EEF2F7` / `#E4EAF1` | `#151B2A` / `#1C2333` | Fields and chips / hover and selection |
| `--text` | `#0B0F19` | `#F2F5FA` | Primary text |
| `--muted` | `#4F5A6B` | `#9AA4B8` | Secondary text |
| `--dim` | `#5F6A7D` | `#7A849A` | Section labels, metadata |
| `--border` / `--hairline` | `#DFE5EE` / `#E9EEF4` | `#1E2536` / `#161C2A` | Outlines / dividers inside a group |
| `--control-border` | `#7F8897` | `#656E82` | The outline of fields, the chosen segment and the switch track: `--dim` mixed 80% into `--card` |
| `--brand` | `#006E9C` | `#00C2FF` | Brand-coloured text and links (AA in both themes) |
| `--ring` | `#0077A8` | `#00C2FF` | Focus ring |
| `--ok` / `--warn` / `--err` | `#137636` / `#A44D08` / `#C81E2E` | `#2FD36F` / `#FFB020` / `#FF5C6C` | Status |
| `--grad` | `#00C2FF` → `#00F0B8` at 45° | same | Brand and "on" states |
| `--hud-*` | navy at 88% | same | The overlay pill, which is dark in both themes |

**Rules**

- The gradient marks the brand and things that are on: the icon, primary buttons, switches that are on, progress, and the listening state. Use it on small elements, never as the background of a large area.
- Text on the gradient is navy (`--on-grad`): 9.3:1 on the blue end and 12.9:1 on the mint end. White fails at 2.1:1 and 1.5:1.
- Status is never shown by colour alone; a word always goes with it.
- `--dim` is for text on `--bg`, `--card` and `--surface2`. On dark `--surface3` it drops to 4.2:1, so use `--muted` there.
- A control whose outline is what identifies it (a text field, a select, the chosen segment, a switch) uses `--control-border`, which is 3:1 against its background. `--border` (about 1.2:1) is for surfaces, and for buttons, whose label identifies them. A switch that is on gets a `--brand` rim, because the gradient alone is 2.1:1 or less on a light card.

**Contrast**, checked with the WCAG formula:

| Pair | Light | Dark |
| --- | --- | --- |
| `--text` on `--bg` / `--card` | 17.8 / 19.2 | 17.5 / 16.8 |
| `--muted` on `--bg` / `--surface3` | 6.5 / 5.8 | 7.6 / 6.3 |
| `--dim` on `--bg` / `--surface2` | 5.1 / 4.9 | 5.1 / 4.6 |
| `--brand` on `--bg` | 5.3 | 9.3 |
| `--ok` / `--warn` / `--err` on `--card` | 5.7 / 5.8 / 5.7 | 9.3 / 10.1 / 6.1 |
| `--ring` on `--bg` (needs 3:1) | 4.7 | 9.3 |
| `--control-border` on `--card` / `--bg` (needs 3:1) | 3.6 / 3.3 | 3.6 / 3.7 |
| `--hud-text` / `--hud-muted` on the pill over white | 12.8 / 5.6 | same |

## Typography

The system font (SF Pro, through `--font-ui`) in the macOS text styles. Weights are 400, 500 and 600 only.

| Style | Token | Size | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| Large title | `--text-large-title` | 26 px | 600 | −0.016em | Onboarding headline |
| Title 1 | `--text-title-1` | 22 px | 600 | −0.01em | View titles |
| Title 2 | `--text-title-2` | 17 px | 600 | −0.01em | Large section titles (rare) |
| Title 3 | `--text-title-3` | 15 px | 500–600 | 0 | Group titles, the app name in the sidebar |
| Body | `--text-body` | 13 px | 400–500 | 0 | Everything else |
| Callout | `--text-callout` | 12 px | 400 | 0 | Second lines, notes, chips |
| Caption | `--text-caption` | 11 px | 400, or 600 uppercase at +0.06em | 0 / `--tracking-label` | Metadata, or section labels |

- Sentence case everywhere. Uppercase only for caption-size section labels.
- Tracking tightens as text grows: titles are negative, body is 0.
- Line height is 1.45 for body (`--leading-body`) and 1.2 for titles (`--leading-tight`).
- Numbers that change or line up (sizes, percentages, times) use `font-variant-numeric: tabular-nums`.

## Spacing and layout

A 4 px grid: `--space-1` (4) to `--space-12` (48).

- Rhythm: 8 px inside controls, 12–16 px inside rows and cards, 24–32 px between sections.
- 1–2 px values are optical adjustments (insets, borders), not spacing.
- Layout constants: the window is 780 × 540 px, the sidebar 200 px wide and content at most 620 px wide. A 40 px strip at the top drags the window, and the traffic lights sit at 18, 18.
- Control sizes are sizes, not spacing: sidebar rows are 32 px tall, icon buttons and permission icon tiles 28 px, the status dot 12 px. The first-run screen fits the default window without scrolling.

## Shape

| Token | Radius | Use |
| --- | --- | --- |
| `--radius-xs` | 4 px | Tiny marks, key caps |
| `--radius-sm` | 6 px | Items inset 2 px inside an 8 px container |
| `--radius-md` | 8 px | Buttons, fields, segmented tracks, sidebar items |
| `--radius-lg` | 10 px | Groups, cards, notices |
| `--radius-xl` | 14 px | Large surfaces: setup and onboarding panels |
| `--radius-pill` | 999 px | Chips, switches, progress, the overlay pill |

Nested shapes are concentric: inner radius = outer radius − inset. A segmented track at 8 px with a 2 px inset gets 6 px segments.

## Depth and materials

- Surfaces are flat and separated by hairlines (`--border`, `--hairline`), not shadows.
- Shadows are only for things that float or sit raised: the selected segment (`--shadow-raised`), the switch knob (`--shadow-knob`) and the overlay pill (`--hud-shadow`).
- The overlay pill is navy at 88% with a light hairline. On a dark wallpaper the fill alone is 1.1:1, so the hairline is what keeps its edge visible.
- Reduce Transparency makes the pill opaque, and Increase Contrast strengthens borders. `tokens.css` handles both.
- No native sidebar vibrancy. Electron's `sidebar` material would replace the Rozeno sidebar colour with a translucent system one, and the palette comes only from the tokens.

## Motion

Decide by frequency first, then purpose, then curve and duration.

| What | How often | Motion |
| --- | --- | --- |
| Overlay appears on the hotkey | 100+ times a day, from the keyboard | No delay before listening starts. At most a quick fade from `--enter-scale`, and leaving is faster than arriving. |
| Listening | During every dictation | Continuous feedback tied to the voice level, not a decorative loop |
| Transcribing, done, error | Every dictation | A clear state change, then the pill leaves |
| Switching sections in the app window | Tens of times a day | None. Instant. |
| Press | Constantly | Buttons and segments scale to `--press-scale` over `--duration-quick` with `--ease-out`. Sidebar rows darken instead, like the system's. |
| Hover, colour | Constantly | `--duration-fast` with `ease` |
| Switches, segmented controls | Occasionally | `--duration-fast` |
| Download progress | During downloads | `transform: scaleX()`, linear |
| First run, onboarding | Once | May enter with a fade and a `--enter-offset` rise, staggered 30–80 ms |

| Curve | Token | For |
| --- | --- | --- |
| Strong ease-out | `--ease-out` | Entering, leaving, press feedback |
| Strong ease-in-out | `--ease-in-out` | Things moving on screen |
| Drawer | `--ease-drawer` | Sheets and panels |
| `ease` | (built in) | Hover and colour |

- Durations come from `--duration-quick` (120 ms), `--duration-fast` (150), `--duration-base` (200) and `--duration-slow` (250). Interface motion stays under 300 ms.
- Never `ease-in`, never `transition: all`, and never start from `scale(0)`.
- Animate `transform` and `opacity` only.
- Use transitions rather than keyframes for anything that can retrigger, so it can be interrupted.
- **Reduce Motion means gentler, not none.** The movement tokens (`--press-scale`, `--enter-scale`, `--enter-offset`) switch to no movement, while fades and colour changes stay.

## Iconography

- **The mark** is the Speaking D (`assets/icon`): a navy glyph on the gradient tile. Wherever the brand appears inside the app, use the mark, not a gradient square.
- **Interface icons:** SF Symbols can't be drawn in a web view, so icons are hand-drawn SVG in the same spirit: a 16 px grid, 1.5 px strokes, round caps and joins, `currentColor`. They live with the mark in one sprite at the top of `app.html` (microphone, keyboard, accessibility, check, remove).
- **Menu bar:** a template image, black with alpha, at 18 pt with an @2x version, with straight edges on whole pixels.

## Accessibility

- **Contrast:** text is at least 4.5:1. The focus ring and any boundary that identifies a control are at least 3:1.
- **Focus:** a 2 px `--ring` outline, offset 2 px, on `:focus-visible`.
- **Keyboard:** everything is reachable with Tab, and nothing traps focus. Segmented controls behave as radio groups (arrow keys, one tab stop), and Esc cancels.
- **Semantics:** native elements first. Custom controls get the right role and state (switch, `aria-checked`, `progressbar` with `aria-valuenow`), and status changes are announced politely (`aria-live`).
- **Targets:** at least 24 × 24 px (WCAG 2.2 AA).
- **System settings:** light and dark, Reduce Motion, Reduce Transparency and Increase Contrast are all handled by the tokens.

## Permissions and onboarding

Diktatorn needs three permissions: Microphone, Input Monitoring (to notice the dictation key) and Accessibility (to type the text).

- **First run** shows one screen: the mark, "Welcome to Diktatorn", an "Allow access" group with all three permissions, and one combined download bar for the first-run models. It enters once with a staggered fade and rise. When the downloads finish, the window switches to Home.
- **Each permission row** has an icon tile, the name, one line on why it's needed, and either "Allowed" with a check or an "Open System Settings" button for that exact pane. The tile turns to the gradient once the permission is on, and the word says it too.
- **Status is live.** The window updates as soon as a permission is switched on, without a restart or a click: the main process re-checks the microphone every second while it's off, the helper watches Accessibility, and it restarts itself when Input Monitoring comes on.
- **After first run,** Home shows only the permissions that are missing, in the same rows, and the status reads "Needs your attention".
- The buttons open fixed System Settings URLs held by the main process; the window can only name which permission.

## Copy

- **English**, in sentence case.
- **Short and specific.** Buttons are verbs: "Download", "Retry", "Open System Settings".
- **Say what happened and what to do:** "Diktatorn needs Input Monitoring to hear the dictation key."
- **No exclamation marks, no blame,** and no jargon in the app window: no "ASR", "VAD" or "LLM" (the debug window is exempt).
- **Keys are written as they appear on the keyboard:** fn, ⌥, ⌘, esc.

## Known gaps

Found while auditing the renderer for this brief.

**Overlay pill**

- The pill's shadow is cut off by its 300 × 56 window, which shows as a faint rectangle on light backgrounds.
- The listening pulse is a decorative loop; it should respond to the voice instead.
- Listening and hands-free differ only by colour and wording.
