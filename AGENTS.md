# AGENTS.md

## Cursor Cloud specific instructions

This is a Node.js monorepo (root + `backend/` + `frontend/`) for a personal finance dashboard ("My Worth Track").

### Project layout

| Directory | Service | Port | Tech |
|-----------|---------|------|------|
| `backend/` | Express API | 4000 | Express 4, pg, googleapis SDK |
| `frontend/` | Vite dev server | 5173 | React 19, Vite 7, Recharts |

### Prerequisites

- **Node.js 22** (matches CI)
- **PostgreSQL** — required for auth sessions, users, cash, portfolio positions, net-worth history

### Running the app

Standard commands are in the root `package.json`:

- `npm run setup` — install all dependencies (root + backend + frontend)
- `npm run dev` — start both backend and frontend concurrently
- `npm run dev:backend` / `npm run dev:frontend` — start individually
- `npm test` — run backend unit tests (`node --test`)
- `npm run lint --prefix frontend` — ESLint on frontend
- `npm run build --prefix frontend` — production build of frontend

### Database setup

1. Start PostgreSQL: `sudo pg_ctlcluster <version> main start`
2. Create the database: `sudo -u postgres psql -c "CREATE DATABASE billy_finance;"`
3. Run migrations: `cd backend && node src/db/migrate.js`

### Authentication

The app uses OAuth (Google/Apple/WeChat) with cookie-based sessions (`bf_session`). There is no built-in dev bypass. To access the dashboard locally without OAuth credentials, you can seed a user and session directly:

```sql
sudo -u postgres psql billy_finance -c "
INSERT INTO users (id, email, display_name, public_id, onboarding_completed, base_currency)
VALUES ('a0000000-0000-0000-0000-000000000001', 'dev@localhost', 'Dev User', 'dev-user-001', true, 'USD')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_sessions (id, user_id, session_token, expires_at)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'dev-session-token-12345', NOW() + INTERVAL '14 days')
ON CONFLICT (id) DO NOTHING;
"
```

Then set the cookie in the browser console: `document.cookie = "bf_session=dev-session-token-12345; path=/"`

### Caveats

- The backend requires a `backend/.env` file (copy from `backend/.env.example`). Key vars: `DATABASE_URL`, `DATABASE_SSL=false` (for local), `FRONTEND_BASE_URL=http://localhost:5173`.
- Backend uses `node --watch` for hot reload in dev. Adding new files may require a restart.
- Frontend lint currently has 3 pre-existing errors in the latest codebase (unused var, set-state-in-effect, react-refresh export warning).
- No Docker, no Makefile, no pre-commit hooks.
