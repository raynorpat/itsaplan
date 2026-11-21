# Vendored Linear schema

`schema.graphql` is Linear's published GraphQL schema, served unmodified at `/graphql`.

- Source: `packages/sdk/src/schema.graphql` in https://github.com/linear/linear
- Tag: `@linear/sdk@103.0.0`
- Commit: `2ca00918e3ae699a0aa1a6b07330b433397cd201` (2026-11-18)

The `@linear/sdk` dev dependency in `apps/api/package.json` is pinned to the same
release. `__tests__/unit/sdk-documents.test.ts` validates every operation that SDK
sends against this file.

To update: download `schema.graphql` from the new SDK tag, bump `@linear/sdk` to the
same version, update the tag and commit above, and run the test suite. Do not edit
the file by hand.
