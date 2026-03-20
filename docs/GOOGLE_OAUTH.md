# Google OAuth (local + production)

The message **“Google OAuth is not configured.”** means these are missing or still placeholders in **`backend/.env`**:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client secret |
| `GOOGLE_OAUTH_CALLBACK_URL` | Must match **exactly** what you register in Google Cloud |

**Local dev example** (backend on port 4000):

```env
GOOGLE_OAUTH_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
```

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
