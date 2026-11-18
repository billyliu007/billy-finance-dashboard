# Passkeys (WebAuthn)

Passkeys are an **extra** way to sign in to an existing account with Face ID, Touch ID, Windows Hello or a device PIN. They are not a second factor and not a sign-up method: a user first signs in with Google or Microsoft, then adds a passkey under **Settings → Passkeys**. Google and Microsoft keep working, so a lost device never locks anyone out.

No third-party service is involved. The backend uses [`@simplewebauthn/server`](https://simplewebauthn.dev/) and the frontend [`@simplewebauthn/browser`](https://simplewebauthn.dev/) (open source, no keys or accounts).

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `WEBAUTHN_RP_ID` | hostname of the first origin (`localhost` locally) | The domain passkeys are bound to. Production: `myworthtrack.com` (set in `render.yaml`), which covers `app.myworthtrack.com`. **Never change it once passkeys exist**: they would stop working. |
| `WEBAUTHN_ORIGINS` | `FRONTEND_BASE_URL`, else `http://localhost:5173` | Comma-separated frontend origins where the passkey prompt runs. Each hostname must equal or end with `.<WEBAUTHN_RP_ID>`; otherwise passkeys are disabled (`/api/auth/providers` reports `passkey: false`). |

Local development needs no extra settings. Browsers allow passkeys on `http://localhost`; everywhere else HTTPS is required. Open the app at `http://localhost:5173` (not a LAN IP) when testing locally.

## How it works

| Route (`/api/auth/passkey/…`) | Auth | Purpose |
|------|------|---------|
| `POST register/options` | signed-in browser session | Options for creating a passkey; stores a one-time challenge in an httpOnly cookie. |
| `POST register/verify` | signed-in browser session | Verifies the new passkey and saves its public key. |
| `POST login/options` | none | Options for a "discoverable" sign-in (the device lists its passkeys for this site). |
| `POST login/verify` | none | Verifies the signature, updates the counter and sets the normal `bf_session` cookie. |
| `GET /` | signed in | Lists the user's passkeys (name, created, last used, synced). |
| `DELETE /:id` | signed-in browser session | Removes one of the user's passkeys. |

- **Data:** table `user_passkeys` (migration `20261118_user_passkeys.sql`) stores the credential ID, the **public** key, the signature counter, transports, whether it's synced, a name and timestamps. Private keys never leave the user's device.
- **Challenges:** each ceremony gets a server-generated challenge in a 5-minute httpOnly cookie (`bf_passkey_challenge_register` / `_login`, path `/api/auth/passkey`), cleared on use.
- **Limits:** up to 10 passkeys per user. The shared demo account can't add passkeys. API tokens can't manage passkeys.

## Troubleshooting

- **Button missing on the login page:** the browser doesn't support WebAuthn, or the config is inconsistent (`/api/auth/providers` shows `passkey: false`), e.g. `WEBAUTHN_RP_ID` doesn't match the frontend hostname.
- **"This passkey isn't registered with My Worth Track":** the device offered a passkey from another account or environment (local passkeys are bound to `localhost` and don't work in production, and vice versa). Sign in another way and add a passkey for this environment.
- **"That took too long":** the challenge cookie expired (5 minutes) or third-party cookies for the API domain are blocked. Try again.
