# AGENTS.md

## Cursor Cloud specific instructions

This is a Node.js monorepo (root + `backend/` + `frontend/`) for a personal finance dashboard powered by Google Sheets.

### Project layout

| Directory | Service | Port | Tech |
|-----------|---------|------|------|
| `backend/` | Express API | 4000 | Express 4, googleapis SDK |
| `frontend/` | Vite dev server | 5173 | React 19, Vite 7, Recharts |

### Running the app

Standard commands are in the root `package.json`:

- `npm run setup` — install all dependencies (root + backend + frontend)
- `npm run dev` — start both backend and frontend concurrently
- `npm run dev:backend` / `npm run dev:frontend` — start individually
- `npm test` — run backend unit tests (`node --test`)
- `npm run lint --prefix frontend` — ESLint on frontend
- `npm run build --prefix frontend` — production build of frontend

### Caveats

- The backend requires a `backend/.env` file (copy from `backend/.env.example`). Without valid Google Sheets credentials the API endpoints other than `/api/health` will error, but the frontend still renders error states.
- Backend uses `node --watch` for hot reload in dev. Adding new files may require a restart.
- There is no database; all data comes from Google Sheets via the service account.
- No Docker, no Makefile, no pre-commit hooks.
