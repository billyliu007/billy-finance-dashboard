# Google OAuth (local + production)

The message **“Google OAuth is not configured.”** means these are missing or still placeholders in **`backend/.env`**:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client secret |
| `GOOGLE_OAUTH_CALLBACK_URL` | Optional fallback; normally the app builds the callback URL from the request (see below). |

**Local dev** (browser → Vite on 5173, API on 4000): the backend derives  
`http://<host>:4000/api/auth/google/callback` from the incoming request (Vite sends `X-Forwarded-Host`). You must register **every** redirect URI you use in Google Cloud, for example:

- `http://localhost:4000/api/auth/google/callback` — opening the app at `http://localhost:5173`
- `http://192.168.x.x:4000/api/auth/google/callback` — opening the app at `http://192.168.x.x:5173` on your LAN

If OAuth starts **without** that forwarded host (e.g. a direct hit to the API), set an explicit callback:

```env
GOOGLE_OAUTH_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
```

**Production (HTTPS):** set `TRUST_PROXY=true` on the host (see `render.yaml`) so `redirect_uri` uses `https://`. Set `FRONTEND_BASE_URL` to your deployed SPA origin. `GOOGLE_OAUTH_CALLBACK_URL` should match your API’s public callback URL and Google’s **Authorized redirect URIs**.

## 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select or create a project.
2. **APIs & Services** → **OAuth consent screen** → configure (External is fine for testing; add your email as test user if app is in Testing).
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
4. Application type: **Web application**.
5. **Authorized redirect URIs** — add the same URL as `GOOGLE_OAUTH_CALLBACK_URL`, e.g.  
   `http://localhost:4000/api/auth/google/callback`
6. Copy **Client ID** and **Client secret** into `backend/.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

## 2. Restart the backend

After saving `.env`, restart the Node server so it picks up the new variables.

## 3. Without Google

You can use **Login Demo Account** on the login screen; that only needs a working **`DATABASE_URL`** and migrated database (see `README.md` / `DEPLOYMENT.md`).
