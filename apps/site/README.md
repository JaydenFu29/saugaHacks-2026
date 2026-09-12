# apps/site — AidLive presentation site

The public/pitch site from [DEVELOPMENT.md](../../DEVELOPMENT.md) §2. Plain HTML, CSS
and JS — no build step, no dependencies, no framework.

## Run it

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>. Any static server works; opening `index.html`
directly via `file://` also works.

## Files

| File | Contains |
|---|---|
| `index.html` | All page markup — nav, hero, statement, How It Works, capabilities, safety, emergency CTA, contact, footer |
| `styles.css` | Everything visual. Palette + type scale are CSS custom properties at the top (`:root`) |
| `script.js` | Scroll reveals, count-up stats, active-step tracking, nav scroll-spy, mobile menu, form/emergency placeholders |
| `assets/*.svg` | **Placeholder** imagery — see below |

## Design provenance

Type scale, button geometry and motion are matched to the
[reference](https://thepinboard.co.uk) the team picked:

- **Headings** Satoshi 400 — 112 / 52 / 40 / 38 / 34 / 20px, line-height ~1.0–1.2,
  letter-spacing −0.04em → −0.01em (tighter as size grows)
- **Body/UI** Inter 400 — 18 / 16 / 13 / 12px
- **Buttons** 40px tall, `border-radius: 100px`, 8px/20px padding
- **Ground** `#FCFCFA` warm off-white

Palette is re-grounded for healthcare, from the `ui-ux-pro-max` skill's
*Emergency SOS & Safety* and *Healthcare App* entries:

- `--teal: #0891B2` — structure, eyebrow dots, active step numbers
- `--red: #DC2626` — **emergency only.** Deliberately the single loud element on an
  otherwise calm page; a panicking bystander shouldn't meet a shouting interface, but
  the emergency action must be unmissable.
- `--ink: #0F172A` — text

Change any of these in one place: the `:root` block in `styles.css`.

## Swapping the placeholders

Replace the files in `assets/` with real images at the same paths and nothing else needs
editing (`hero.svg`, `step-01`–`step-04.svg`, `portrait.svg`). The brand name "AidLive"
and the dot-cross mark are filler too — the mark is inline SVG in `index.html`
(`.brand__mark`, two copies: nav and footer).

## Known placeholders

- **Emergency button** → currently scrolls to the `#emergency` section. Point it at the
  `apps/web` session URL once that app exists (marked `TODO` in `index.html`).
- **Contact form** → validates client-side, sends nothing. Needs a backend endpoint.
- **Stats** (4 protocols / 15+ languages / 60s) → the language count is real (19 offered in
  the emergency app's picker); protocols and 60s are still placeholders.

## Accessibility notes

Skip link, visible focus rings, labelled form fields, ARIA state on the mobile menu,
`aria-live` form status, and a full `prefers-reduced-motion` block that disables all
motion without hiding any content. Keep these working when editing — the whole premise
of this product is that it works for people under stress.
