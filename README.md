# ISchedule timetable planner

ISchedule is a full-stack college timetable planner with a constraint-based scheduling engine, persistent SQLite storage, account roles, shared workspaces, manual placement, publication, audit history, and CSV/ICS export.

## Requirements

- Node.js 24 or newer
- npm
- Chromium for browser checks (`npx playwright install chromium` when it is not already installed)

## Development

```bash
npm install
npm run dev
```

The development command starts the API at `http://127.0.0.1:4174` and Vite at `http://127.0.0.1:5173`. Open the Vite address in a browser. The first registered account becomes the administrator. Use **Continue with local workspace** when you need a private, browser-only workspace without an account or server data.

## Workspaces and roles

An online workspace is shared through the server and stored in SQLite. A local workspace is stored in the current browser and is useful for trying the scheduler or preparing a draft without changing shared data. New local and online workspaces start empty; add or import the resources for the term before generating a timetable.

| Role | Access |
| --- | --- |
| **Admin** | Manage resources and accounts, save versions, publish a timetable, review audit history, and restore server history. The first account is the bootstrap admin. |
| **Planner** | Edit resources, import data, run the deterministic or AI-assisted planner, save versions, and work with timetable drafts. |
| **Faculty** | See the published timetable for linked teaching records and maintain their availability when linked by an administrator. |
| **Student** | See the published timetable for the linked student group. |
| **Viewer** | Read-only access to the published timetable. Before an administrator or planner publishes a version, the viewer sees the explicit no-published-timetable state. |

Admins can invite non-admin roles and link faculty or student accounts to workspace records. Draft data is not automatically visible to faculty, students, or viewers: save a named timetable version, check it, and publish it when ready. Publishing replaces the previously published version; it does not erase the draft workspace.

## Resources, availability, and scheduling

Maintain faculty, student groups, rooms, and courses before generating. Faculty availability is entered as unavailable day/period cells. Courses can require a room type and room features; rooms provide capacity, type, and feature labels. The scheduler considers these hard constraints along with session duration, group size, faculty limits, teaching days, and locked placements. Preferences such as morning classes, balanced days, fewer gaps, and avoiding the final period rank valid alternatives without overriding hard constraints.

The timetable report identifies placed and unscheduled sessions, quality, rooms, and conflicts that need attention. A planner can manually place an unscheduled session, edit or lock a placement, regenerate, and review the result before publication. Read-only roles cannot use these controls.

## Bulk CSV import and templates

The Settings bulk-import workflow imports one resource kind at a time. Download its template from the workflow rather than copying a table from a rendered page. The first row is the header and the `id` column updates an existing record or adds a new one. Imports are previewed and validated before they change the workspace.

The current template headers are:

```text
courses: id,name,code,facultyId,groupId,weeklySessions,duration,roomType,color,requiredFeatures
faculty: id,name,email,department,maxDailyPeriods,unavailable,preferred
rooms: id,name,building,capacity,type,features
groups: id,name,department,size,semester
```

List-valued fields use `|` between values. For example, a room can use `projector|whiteboard` in `features`, a course can use `projector` in `requiredFeatures`, and availability slots use IDs such as `0-0|4-6`. IDs referenced by courses must already exist in the faculty and group collections. Imports are limited to 500 records per resource kind and report row and field errors before the import can be confirmed.

## Terms and calendar export

Set the academic year, semester, department, start date, end date, and IANA time zone for the workspace term. The ICS export uses that term to create weekly recurring events bounded by the term end date. Events include the course, room, student group, and faculty. Exports can be scoped to the full timetable or to a faculty member, group, or room where the relevant report control is available. The ordinary CSV export remains a flat, human-readable timetable export.

## Administration and audit

Admin Settings contains account and access controls, invitations, role links, timetable versions, and publication controls. Server changes such as registration, login, workspace saves, version creation, publication, invitations, password actions, and AI planning are recorded in the admin audit view. Keep audit records with the workspace backup when investigating a publication or access change.

Back up a shared workspace before a large import or migration:

```bash
npm run backup
```

## Production

```bash
npm run build
npm start
```

The server serves the built frontend and API from port `4174`. Configure `PUBLIC_ORIGIN=https://your-domain.example` behind an HTTPS reverse proxy. Store the SQLite database outside the application directory with `ISCHEDULE_DATA_DIR`.

The supported local AI path uses Ollama (`llama3.2:3b` at `http://127.0.0.1:11434/v1`) and does not require paid API credits:

```bash
ollama pull llama3.2:3b
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_MODEL=llama3.2:3b OPENAI_API_KEY=ollama npm start
```

The key is never sent to the browser. The AI supplies a planning order using a strict JSON schema limited to the workspace's exact course IDs, not course codes. ISchedule still rejects unknown or duplicate IDs and generates the final placement against hard constraints. Paid model switching is not part of the documented workflow or browser test path; keep model checks on localhost Ollama.

Docker is also supported:

```bash
docker compose up --build -d
docker compose exec ischedule node scripts/backup.mjs
```

### Legacy migration

When a data directory is opened for the first time, the server preserves compatible legacy `store.json` workspace and account data while creating the SQLite store. A legacy `campusly.sqlite` file is also recognized when no `ischedule.sqlite` exists. Back up the original data directory, start once with the intended `ISCHEDULE_DATA_DIR`, verify accounts, resources, terms, and publications, and only then retire the legacy copy.

## Checks

```bash
npm test
npm run build
npx playwright install chromium       # once per machine if Chromium is missing
npm run test:e2e
npm run test:ollama                    # localhost /api/version and OpenAI-compatible chat
npm run test:ollama -- --app-flow     # optional isolated app AI flow; requires a built server
```

Vitest includes only `tests/**/*.test.ts` and excludes `e2e/**`. Playwright serves the production `dist/` bundle through `scripts/e2e-server.mjs` on `127.0.0.1:4180`. Each run creates a fresh operating-system temporary data directory, disables SMTP and model credentials, and removes the database when the server stops; it never uses `server/data` or real accounts. The optional Ollama app flow uses another temporary database, a `.invalid` test account, and localhost only.

The Ollama chat check allows 90 seconds for CPU model loading. The optional app check allows 75 seconds for the server's 60-second AI request and confirms the requested course is placed with its exact ID. A reachable `/api/version` endpoint alone does not prove that AI planning works; run `npm run test:ollama -- --app-flow` after rebuilding the server.

CI runs the unit tests, production build, Chromium setup, and isolated browser suite. If the browser binary is not available locally, install it with the command above; do not interpret an unrun browser suite as passing.

The scheduler runs locally in a Web Worker. Hard constraints are always validated before a placement is accepted; soft preferences rank valid alternatives.
