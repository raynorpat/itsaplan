-- Passwords are gone: people sign in with a magic link, Google or a passkey. Delete
-- the stored password credentials (better-auth's `credential` accounts).
DELETE FROM "account" WHERE "provider_id" = 'credential';
