# ISchedule timetable planner

ISchedule is a full-stack college timetable planner with a constraint-based scheduling engine, persistent SQLite storage, account roles, shared workspaces, manual placement, publishing, and CSV/ICS export.

## Requirements

- Node.js 24 or newer
- npm

## Development

```bash
npm install
npm run dev
```

The development command starts the API at `http://127.0.0.1:4174` and Vite at `http://127.0.0.1:5173`. Open the Vite address in a browser. The first registered account becomes the administrator.

## Production

```bash
npm start
```

The server serves the built frontend and API from port `4174`. Configure `PUBLIC_ORIGIN=https://your-domain.example` behind an HTTPS reverse proxy. Store the SQLite database outside the application directory with `ISCHEDULE_DATA_DIR`.

To enable the AI timetable planner, configure `OPENAI_API_KEY` on the server. The key is never sent to the browser. `OPENAI_MODEL` defaults to `gpt-4o-mini`; the AI proposes placements and the server validates every placement against ISchedule's hard constraints before accepting it.

Docker is also supported:

```bash
docker compose up --build -d
docker compose exec ischedule node scripts/backup.mjs
```

## Checks

```bash
npm run build
npm test
```

The scheduler runs locally in a Web Worker. Hard constraints are always validated before a placement is accepted; soft preferences rank valid alternatives.
