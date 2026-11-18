-- Allow 'microsoft' (personal Microsoft accounts) as a sign-in identity provider.
ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_provider_check;
ALTER TABLE user_identities
  ADD CONSTRAINT user_identities_provider_check
  CHECK (provider IN ('google', 'apple', 'wechat', 'microsoft'));
