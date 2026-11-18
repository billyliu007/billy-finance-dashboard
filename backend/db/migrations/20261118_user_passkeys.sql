-- Passkeys (WebAuthn) as an alternative sign-in method for an existing account.
-- Only the public key is stored; the private key never leaves the user's device.
CREATE TABLE IF NOT EXISTS user_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,          -- base64url credential ID from the authenticator
  public_key TEXT NOT NULL,                    -- base64url COSE public key
  counter BIGINT NOT NULL DEFAULT 0,           -- signature counter (0 for most synced passkeys)
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type TEXT,                            -- 'singleDevice' | 'multiDevice'
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,     -- synced (iCloud Keychain, Google Password Manager, ...)
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id);
