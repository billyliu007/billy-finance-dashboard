# Microsoft sign-in (personal accounts)

"Continue with Microsoft" lets people sign in with a **personal** Microsoft account (Outlook.com, Hotmail, Live, Xbox). Work and school (Entra ID) accounts are intentionally **not** accepted.

**Why personal accounts only:** accounts are linked by email address (signing in with Microsoft as `you@example.com` opens the existing `you@example.com` account). For personal accounts Microsoft verifies the sign-in email. In work/school tenants an administrator can set any email address on a user, which would let someone claim another person's account. The backend enforces this by using the `consumers` endpoint and checking the token's tenant (`tid`).

The button appears only when all three variables below are set.

| Variable | Value |
|----------|-------|
| `MICROSOFT_OAUTH_CLIENT_ID` | Application (client) ID from the app registration |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | Client secret **value** (not the secret ID) |
| `MICROSOFT_OAUTH_CALLBACK_URL` | Local: `http://localhost:4000/api/auth/microsoft/callback` · Production: `https://api.myworthtrack.com/api/auth/microsoft/callback` |

## 1. Register the app (one registration covers local and production)

0. **You need a Microsoft Entra tenant (directory) to register an app.** A personal Microsoft account (e.g. `@hotmail.com`) on its own can't sign in to the portals and gets *"Selected user account does not exist in tenant 'Microsoft Services'"*. The simplest fix is to create a free Azure account with that personal account at [azure.microsoft.com/free](https://azure.microsoft.com/free); this creates a "Default Directory" tenant you own. App registrations are free; Microsoft may ask for a card only to verify your identity.
1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com/) (or portal.azure.com), signed in to that tenant → **App registrations** → **New registration**.
2. **Name:** `My Worth Track`.
3. **Supported account types:** **Personal Microsoft accounts only**.
4. **Redirect URI:** platform **Web**, `http://localhost:4000/api/auth/microsoft/callback`. Register.
5. **Authentication** → under **Web** → **Add URI**: `https://api.myworthtrack.com/api/auth/microsoft/callback`. Save.
6. **Overview** → copy **Application (client) ID** → `MICROSOFT_OAUTH_CLIENT_ID`.
7. **Certificates & secrets** → **New client secret** → pick an expiry (max 24 months) → copy the **Value** immediately (it's shown once) → `MICROSOFT_OAUTH_CLIENT_SECRET`.

No API permissions need to be added; `openid email profile` are granted by default.

## 2. Configure the backend

- **Local:** put the three values in `backend/.env` and restart the backend.
- **Production (Render):** `MICROSOFT_OAUTH_CALLBACK_URL` is set by `render.yaml`. Add `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET` in the Render dashboard (backend service → Environment, or the `netpulse-secrets` env group). Never put them in `render.yaml`: it is committed to git.

## 3. Rotate the client secret before it expires

Microsoft client secrets expire (max 24 months). Set a reminder: create a new secret, update `MICROSOFT_OAUTH_CLIENT_SECRET` in Render, redeploy, then delete the old secret.

## Troubleshooting

- **`AADSTS50011` redirect URI mismatch:** `MICROSOFT_OAUTH_CALLBACK_URL` must exactly match a redirect URI in the app registration.
- **`AADSTS7000215` invalid client secret:** you copied the secret ID instead of its value, or it expired.
- **"Only personal Microsoft accounts … are supported":** the user picked a work/school account.
- **"Sign-in session expired or was started elsewhere":** the sign-in took longer than 10 minutes, or cookies are blocked for the API domain. Start again.
