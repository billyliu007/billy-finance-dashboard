## Apple Login Setup (Render + Backend)

Step‑by‑step guide to enable **“Sign in with Apple”** for `myworthtrack` using Apple Developer, your backend, and Render environment variables.

---

### 1. Prerequisites

- **Apple Developer account**:  
  - You need access to the Apple Developer Program for the `myworthtrack` app.
- **Backend base URL**:  
  - **Production** (Render): `https://api.myworthtrack.com`  
  - The backend must expose:  
    - `GET /api/auth/apple/start`  
    - `GET /api/auth/apple/callback`
- **Team ID**:  
  - From Apple Developer → top right account name → **Team ID** (you’ll need this for the client secret JWT).

Keep these three handy before you start: **Team ID**, planned **Services ID** (client ID), and the backend **callback URL**.

---

### 2. Create / configure App ID (Sign in with Apple)

1. Go to **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**.
2. Click **+** to create a new identifier (or edit an existing one for this app).
3. Choose **App IDs → App** and continue.
4. Set:
   - **Description**: e.g. `MyWorthTrack`
   - **Bundle ID**: e.g. `com.myworthtrack.app` (if you already have one, just reuse it).
5. In **Capabilities**, enable **Sign In with Apple**.
6. Save the App ID.

You now have an App ID that supports Sign in with Apple and can be linked to web / services IDs.

---

### 3. Create Services ID (web client)

This is the **web client ID** used by the backend (`APPLE_CLIENT_ID`).

1. In **Identifiers**, click **+** again.
2. Select **Services IDs** and continue.
3. Configure:
   - **Description**: e.g. `MyWorthTrack Web`
   - **Identifier**: e.g. `com.myworthtrack.web`  
     - This exact string will become your **`APPLE_CLIENT_ID`**.
4. After creating the Services ID, click into it to edit details.
5. Under **Sign In with Apple**:
   - Tick **Sign In with Apple**.
   - Click **Configure**.
   - For **Primary App ID**, choose the App ID you created in step 2 (e.g. `com.myworthtrack.app`).
   - Under **Web domain and URLs**:
     - **Domain**: `api.myworthtrack.com`
     - **Return URL** (callback):  
       - `https://api.myworthtrack.com/api/auth/apple/callback`
6. Save the configuration.

At this point you have:

- **Services ID / Client ID**: `com.myworthtrack.web`
- **Redirect / return URL**: `https://api.myworthtrack.com/api/auth/apple/callback`

---

### 4. Create Apple key for Sign in with Apple

1. Go to **Certificates, Identifiers & Profiles → Keys**.
2. Click **+** to create a new key.
3. Set:
   - **Key Name**: e.g. `MyWorthTrack SignInWithApple`
   - Enable **Sign In with Apple**.
4. Click **Configure** next to Sign in with Apple:
   - Associate it with the same **Primary App ID** you used above.
   - Save.
5. Click **Continue → Register**.
6. **Download the `.p8` file once**:
   - This file contains your private key and **cannot be downloaded again**.
   - Save it securely (e.g. `AuthKey_XXXXXXX.p8`).
7. Note down:
   - **Key ID** (e.g. `ABC123DEFG`)
   - **Team ID** (from your Apple Developer account)

You now have the three inputs needed for the client secret JWT:

- **Team ID**
- **Key ID**
- **Client ID (Services ID)**: `com.myworthtrack.web`

---

### 5. Generate Apple client secret JWT

The backend needs an **Apple client secret**, which is a JWT signed with your `.p8` key. Apple’s recommended expiration is **no more than 6 months**.

You can either:

- Use Apple’s official documentation and any language you prefer, or
- Use a helper script similar to the one below.

#### Example: Node script to generate client secret

Create a small script (locally) named `generate-apple-client-secret.mjs`:

```bash
npm install jsonwebtoken
```

```javascript
// generate-apple-client-secret.mjs
import fs from "fs";
import jwt from "jsonwebtoken";

// Fill these from Apple Developer
const teamId = process.env.APPLE_TEAM_ID;          // e.g. 'ABCD123456'
const clientId = process.env.APPLE_CLIENT_ID;      // e.g. 'com.myworthtrack.web'
const keyId = process.env.APPLE_KEY_ID;            // from the key you created
const privateKeyPath = process.env.APPLE_P8_PATH;  // path to AuthKey_XXXXXXX.p8

const privateKey = fs.readFileSync(privateKeyPath, "utf8");

// Expire in ~6 months (in seconds)
const SIX_MONTHS = 180 * 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

const token = jwt.sign(
  {
    iss: teamId,
    iat: now,
    exp: now + SIX_MONTHS,
    aud: "https://appleid.apple.com",
    sub: clientId,
  },
  privateKey,
  {
    algorithm: "ES256",
    keyid: keyId,
  }
);

console.log(token);
```

Run it locally:

```bash
export APPLE_TEAM_ID=your_team_id
export APPLE_CLIENT_ID=com.myworthtrack.web
export APPLE_KEY_ID=your_key_id
export APPLE_P8_PATH=/absolute/path/to/AuthKey_XXXXXXX.p8
node generate-apple-client-secret.mjs
```

Copy the long JWT string printed to stdout. This becomes your **`APPLE_CLIENT_SECRET`**.  
Set a reminder to regenerate this JWT **every ~6 months** and update the Render env var before it expires.

---

### 6. Configure Render environment variables

In your **Render backend service**:

1. Go to the service → **Environment**.
2. Add or update the following variables:
   - **`APPLE_CLIENT_ID`**:  
     - `com.myworthtrack.web`
   - **`APPLE_CLIENT_SECRET`**:  
     - The JWT generated in step 5.
   - **`APPLE_CALLBACK_URL`**:  
     - `https://api.myworthtrack.com/api/auth/apple/callback`
3. Save the environment changes.

These values must match exactly what you configured in Apple Developer (Services ID + return URL).

---

### 7. Redeploy backend

Once env vars are set:

1. Trigger a **redeploy** of the backend on Render (or deploy as usual).
2. Confirm that the backend process starts successfully and reads:
   - `APPLE_CLIENT_ID`
   - `APPLE_CLIENT_SECRET`
   - `APPLE_CALLBACK_URL`
3. From the frontend, try **Sign in with Apple** and ensure you are redirected to Apple and then back to:
   - `https://api.myworthtrack.com/api/auth/apple/callback`

If everything is correct, Apple login should now work in production.

---

### 8. Checklist

- **Apple Developer**
  - [ ] App ID created with **Sign In with Apple** enabled.
  - [ ] Services ID created (e.g. `com.myworthtrack.web`) and linked to the App ID.
  - [ ] Return URL set to `https://api.myworthtrack.com/api/auth/apple/callback`.
  - [ ] Key created with **Sign In with Apple** enabled.
  - [ ] `.p8` file downloaded and stored securely.
  - [ ] Team ID and Key ID noted.
- **Client secret**
  - [ ] JWT generated using correct **Team ID**, **Key ID**, and **Services ID**.
  - [ ] Expiration set to **≤ 6 months**.
  - [ ] Secret stored securely (not committed to git).
- **Render backend**
  - [ ] `APPLE_CLIENT_ID` = `com.myworthtrack.web`.
  - [ ] `APPLE_CLIENT_SECRET` = generated JWT.
  - [ ] `APPLE_CALLBACK_URL` = `https://api.myworthtrack.com/api/auth/apple/callback`.
  - [ ] Backend redeployed after env changes.
- **App behavior**
  - [ ] Clicking “Sign in with Apple” opens Apple consent screen.
  - [ ] After login, user is redirected back to your backend callback.
  - [ ] Session / account creation works as expected.

---

### 9. Troubleshooting (common errors)

- **`invalid_client` or `invalid_client_id` from Apple**
  - Check `APPLE_CLIENT_ID` exactly matches the **Services ID** (e.g. `com.myworthtrack.web`).
  - Confirm the Services ID is enabled for **Sign In with Apple**.
- **`invalid_redirect_uri`**
  - Ensure `APPLE_CALLBACK_URL` exactly matches the **Return URL** in Apple Developer (including `https://` and path).
  - No trailing slashes or mismatched subdomains.
- **`bad_client_secret` or `client_secret` related errors**
  - Verify the JWT was signed with the correct **`.p8` key** and **Key ID**.
  - Confirm `iss` = **Team ID**, `sub` = **Services ID**, `aud` = `https://appleid.apple.com`.
  - Make sure the token has not expired; regenerate if older than 6 months.
- **User sees a generic “authentication failed” message**
  - Check backend logs around `/api/auth/apple/callback` for the underlying error.
  - Confirm server has access to all `APPLE_*` env vars.
- **Nothing happens on button click in frontend**
  - Ensure the frontend is actually hitting `/api/auth/apple/start`.
  - Verify CORS / redirect handling between frontend and backend.

If all config values match between **Apple Developer**, **Render env vars**, and the backend’s expectations, Apple login should be stable and only require periodic client secret refresh (every ~6 months).

