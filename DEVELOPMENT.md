# DEVELOPMENT.md — Live AI First Aid Assistant

Architecture and work-split plan for the 10-hour hackathon build. **Planning only — no
major features are implemented yet.** See [CLAUDE.md](CLAUDE.md) for the project concept
and constraints.

## 1. Current state

```
saugaHacks-2026/
├── .claude/skills/     # vendored ui-ux-pro-max design skills (installed)
├── .gitignore
├── CLAUDE.md
├── README.md
└── im black/hello.py   # unrelated scratch file, not part of this project
```

No frontend, backend, or config exists yet — this is a green field. Nothing here needs
to be migrated or worked around.

## 2. Proposed repo layout

```
saugaHacks-2026/
├── apps/
│   ├── web/                  # Main emergency web app (React + Vite + TS)
│   └── site/                 # Public/presentation site (judges/demo landing page)
├── server/                   # Backend/API (Node + TS)
│   └── src/
│       ├── routes/           # HTTP route handlers (health, incidents, assistant, summary)
│       ├── ai/                # AI integration module — isolated behind a function interface
│       └── hardware/         # Vitals ingestion endpoint + device simulator
├── shared/
│   └── types/                 # Single source of truth for cross-cutting TS interfaces
├── CLAUDE.md
├── DEVELOPMENT.md            # this file
└── README.md
```

`shared/types` is plain `.ts` — no build step, no npm workspace. Both `apps/web` (Vite)
and `server` (ts-node/tsx) can import it with a relative path
(`../../shared/types`) since neither needs a compiled package, just type-checked
source. This avoids monorepo tooling overhead for a 10-hour build.

### Main emergency web app — `apps/web`

React + Vite + TS SPA. Panels: camera/mic capture, live chat/step transcript, guided
action display (text + image + narration), incident summary/911 view. Talks to `server`
only over HTTP/WebSocket — no direct AI or hardware calls from the browser, so the AI
provider key never reaches the client.

### Public/presentation site — `apps/site`

A separate, small Vite (or plain static HTML) project — the pitch/landing page for
judges, independent of the app's build and unaffected by mid-hackathon app changes. No
shared runtime dependency on `server`; safe to build and deploy at any time without
touching the emergency app.

### Backend/API — `server`

Node + TS (Express or Fastify — pick whichever the backend owner already knows, to move
fast). Owns: incident session state (in-memory, no DB per current scope), request
validation, and orchestration — routes call into `ai/` and `hardware/` modules rather
than embedding that logic inline, so those modules can be swapped or mocked
independently.

### AI integration — `server/src/ai`

A narrow module with one job: given transcript/image/voice input, return structured
guidance (`ActionStep[]`) and a summary. Everything else in the app depends on its
*interface*, not its implementation — so it can start out fully mocked (canned
responses) and have the real model call dropped in later without touching routes or
frontend code.

### Hardware integration — `server/src/hardware`

*Assumption (flag if wrong): an external vitals sensor — e.g. an ESP32/Arduino-class
device or a phone acting as a sensor bridge — pushing periodic readings (heart rate,
SpO2, temperature) to the backend over Wi-Fi.* Isolated the same way as `ai/`: one
ingestion endpoint plus a small simulator script that POSTs fake readings in the same
shape, so the rest of the app never needs real hardware present to be built or demoed.

## 3. Hardware ↔ web API contract

```
POST /api/incidents/:incidentId/vitals
Content-Type: application/json

{
  "deviceId": "esp32-01",
  "timestamp": "2026-09-12T14:03:21.000Z",
  "heartRateBpm": 88,
  "spo2Pct": 97,
  "temperatureC": 36.9
}

→ 202 Accepted, {} 
```

```
GET /api/incidents/:incidentId/vitals/latest

→ 200 OK
{
  "deviceId": "esp32-01",
  "timestamp": "2026-09-12T14:03:21.000Z",
  "heartRateBpm": 88,
  "spo2Pct": 97,
  "temperatureC": 36.9
}
```

- All fields except `deviceId`, `timestamp` are optional — a device may report a subset.
- Backend stores only the latest reading per incident for the MVP (no history/DB).
- If a WebSocket channel is added later (`/ws/incidents/:incidentId`) it carries the same
  JSON shape as a push instead of a poll — the schema doesn't change, only the transport.
- The simulator script (`server/src/hardware/simulate.ts`) hits the POST endpoint on an
  interval with randomized-but-plausible values, so the frontend and AI integration can
  be built and demoed with zero physical hardware.

## 4. Shared data structures (`shared/types`)

```ts
// shared/types/incident.ts
export interface Location {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

export interface VitalsReading {
  deviceId: string;
  timestamp: string; // ISO 8601
  heartRateBpm?: number;
  spo2Pct?: number;
  temperatureC?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  translatedText?: string;
  language?: string; // BCP-47, e.g. "es"
  timestamp: string;
}

export interface ActionStep {
  id: string;
  order: number;
  instruction: string;
  imageUrl?: string;
  audioUrl?: string;
}

export interface EmergencySummary {
  incidentId: string;
  narrative: string;       // concise, spoken-aloud-ready summary for 911
  conditionObserved?: string;
  actionsTaken: string[];
  location?: Location;
  generatedAt: string;
}

export interface Incident {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
  steps: ActionStep[];
  latestVitals?: VitalsReading;
  location?: Location;
  summary?: EmergencySummary;
}
```

Rule: this folder is additive-only during the hackathon — extend interfaces, don't
rename or remove fields others may already be using, and post in the team chat before a
breaking change.

## 5. Feature priority

**MUST HAVE** (the demo doesn't work without these)
- Text input → AI-generated step-by-step guidance, rendered as a step list
- Voice input captured and sent to the assistant (speech-to-text)
- Spoken guidance output (browser TTS is enough)
- One still-frame or short-clip camera capture sent for AI scene description
- Backend endpoints wiring frontend ↔ AI module (`/api/assistant`, `/api/incidents`)
- Simple 911 summary view generated from incident state
- In-memory incident session (create/get), no persistence required
- Health-check endpoint + a documented, working local dev setup

**SHOULD HAVE** (strong demo value, build if MUST HAVE lands early)
- Live translation of voice output into the user's language
- Step images pulled from a small curated first-aid image set
- Browser geolocation captured and included in the 911 summary
- Basic accessibility: captions for spoken output, large-text/high-contrast mode
- Presentation/landing site (`apps/site`) with the pitch, for judges

**IF TIME**
- Hardware vitals integration (real device or the simulator feed) shown live in the UI
- Nearby hospitals lookup
- Incident timeline/history across multiple sessions
- Any dashboard/summary view beyond the single active incident

## 6. Ownership boundaries (4 people, no file conflicts)

| Owner | Folder(s) | Touches shared/types? |
|---|---|---|
| **Frontend/App Lead** | `apps/web/` | reads only |
| **Backend/API Lead** | `server/` (routes, incident store) — everything except `src/ai/` and `src/hardware/` | reads + extends |
| **AI Integration Lead** | `server/src/ai/` | reads + extends (`ActionStep`, `EmergencySummary`) |
| **Presentation + Hardware Lead** | `apps/site/`, `server/src/hardware/` | reads + extends (`VitalsReading`) |

Each person's folder is exclusive — no two people edit files in the same directory, so
merges stay conflict-free. `shared/types` is the one shared surface: treat it as
additive-only (§4 rule) and it won't cause conflicts either.

## 7. First coding task per person

1. **Frontend/App Lead → `apps/web/`**: scaffold Vite + React + TS; build the page shell
   with camera/mic permission prompts and placeholder panels (chat, steps, summary); wire
   one `fetch` to the backend health-check endpoint to prove connectivity. No real AI
   calls yet.

2. **Backend/API Lead → `server/`**: scaffold Express/Fastify + TS; implement
   `GET /health` and `POST /api/incidents` / `GET /api/incidents/:id` returning mock data
   shaped like `Incident` from `shared/types`. Stub (don't implement) the routes that will
   call into `ai/` and `hardware/`.

3. **AI Integration Lead → `server/src/ai/`**: define the module's function signatures
   (e.g. `getGuidance(input): Promise<ActionStep[]>`, `getSummary(incident): Promise<EmergencySummary>`)
   with a mocked implementation returning canned but realistic data — so the Backend Lead
   can wire routes to it today, and the real model call can drop in later without
   touching anything outside this folder.

4. **Presentation + Hardware Lead → `apps/site/` and `server/src/hardware/`**: scaffold
   `apps/site` as a minimal separate page with the project pitch (use the `ui-ux-pro-max`
   / `design` skills for a quick, coherent look — see [CLAUDE.md](CLAUDE.md)); write
   `simulate.ts`, a script that POSTs fake `VitalsReading`s to a stub endpoint on an
   interval, to validate the hardware contract in §3 end-to-end with zero physical device.
