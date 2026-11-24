-- Every OAuth grant includes `read` (Linear: "this scope will always be present"). A
-- client registered before that rule has a scope list without it, and the provider
-- refuses a request for a scope the client did not register, so add `read` to it.
UPDATE "oauth_client"
SET "scopes" = array_append("scopes", 'read')
WHERE "scopes" IS NOT NULL AND NOT ('read' = ANY("scopes"));
