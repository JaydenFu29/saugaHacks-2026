# saugaHacks-2026

2026 Hackathon project: **Live AI First Aid Assistant**.

## Project concept

A web app that helps an untrained bystander during an emergency. The user (recorder)
provides live camera footage, voice, and text. An AI assistant analyzes the situation and
gives cautious, step-by-step first-aid guidance based on vetted protocols.

Planned features (roughly in priority order — build earlier ones first):

1. **Camera analysis** — live camera feed used to detect what's going on with the
   patient/victim, relayed to the app to help inform guidance on what actions to take.
2. **Voice + live translation** — the user can speak to the AI; a translator understands
   what's said and the AI speaks back in the user's own language, so language isn't a
   barrier to understanding what to do.
3. **Step-by-step guided actions** — the app displays what actions to take and narrates
   them at the same time, with images where helpful so the user can identify exactly
   where on the body or scene an action applies.
4. **911 summary** — generate a concise, structured summary of the incident (what
   happened, condition observed, actions taken, location) to relay to emergency services.
5. **Accessibility features** — support beyond voice/visual for users with different
   needs (e.g. captions, screen-reader-friendly structure, high-contrast mode).
6. **Location + incident tracking** — track the incident timeline and the user's
   location for context and for the 911 summary.
7. **Nearby hospitals (optional)** — lower priority; only after the above are solid.

## Team & constraints

- Team of 4 beginner/intermediate developers, **10-hour hackathon** — prioritize a
  working MVP over completeness. Avoid unnecessary complexity or infrastructure.
- **Current phase — foundation only.** Do NOT implement the actual AI, camera
  processing, translation, or any real emergency-response logic yet. This phase is
  scaffolding: a runnable skeleton the team can build features into independently.

## Planned stack & structure

- **Frontend:** React + Vite + TypeScript.
- **Backend:** simple Node.js + TypeScript service, structured so frontend and backend
  can be developed independently (separate folders, no monorepo tooling beyond what's
  needed).
- **Tooling:** ESLint/formatting if it doesn't add much setup overhead — don't
  over-engineer for a 10-hour hackathon.
- **Explicitly out of scope for now:** databases, authentication, Docker, Kubernetes,
  and deployment infrastructure.
- **Must include when scaffolding is built:**
  - a basic frontend page and a backend health-check endpoint so the team can verify
    the two sides talk to each other;
  - a README explaining the project and local dev setup;
  - a `.gitignore` covering macOS, Windows, Node, TypeScript, VS Code, and common
    secret files;
  - an `.env.example` for environment variables — never commit real API keys;
  - the whole thing installable and runnable locally.
- Before scaffolding is implemented, briefly explain the proposed folder structure and
  architecture, then implement it.

## UI/UX Pro Max (installed skills)

[ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) v2.13.0 is
vendored into `.claude/skills/` as project-local skills, so every Claude Code session in
this repo picks them up automatically and teammates get them from a clone. No plugin
install or global setup is needed.

Installed skills:

| Skill | Use for |
|---|---|
| `ui-ux-pro-max` | Core design intelligence — styles, palettes, font pairings, UX guidelines, charts, per-stack guidance |
| `design` | Logo and brand-mark design briefs |
| `design-system` | Design tokens, theme generation, token validation |
| `brand` | Brand guidelines, asset validation |
| `ui-styling` | Stack-level styling (Tailwind, shadcn/ui component installs) |
| `banner-design` | Banners and social/marketing graphics |
| `slides` | Slide decks and pitch presentations |

Use them whenever the task touches how something looks, feels, moves, or is interacted
with — pages, components, color, typography, layout, accessibility, animation, or data
visualization. Skip them for pure backend, API/database, or infrastructure work.

### Running the search tool

Script paths inside these skills are relative to the skill's own directory (the base
directory Claude Code reports when the skill loads), not to the project root. Keep the
working directory at the project root; the scripts read and write project files relative
to it.

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "keyboard focus modal" --domain ux
```

Pick a full design system for a page or product:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hackathon project dashboard" --design-system -p "saugaHacks"
```

### Requirements

- **Python 3.x** — required, standard library only, no network calls. Already present.
- **Node.js** — only needed by 7 scripts in `brand/scripts/` and `design-system/scripts/`
  (`.cjs` token generation/validation and brand-context injection). Not currently
  installed on this machine; every other skill and all Python scripts work without it.
