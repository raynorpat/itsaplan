import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildSchema, parse, validate } from 'graphql';
import { LinearDocument } from '@linear/sdk';

// Every query and mutation the Linear SDK can send must validate against the
// vendored schema the endpoint serves. A schema update that drops or renames a
// field the SDK selects fails here.

const schema = buildSchema(readFileSync(new URL('../../schema.graphql', import.meta.url), 'utf8'));

const operations = Object.entries(LinearDocument as Record<string, unknown>).filter(([name]) =>
  name.endsWith('Document'),
);

describe('Linear SDK documents', () => {
  it('finds the SDK operations', () => {
    expect(operations.length).toBeGreaterThan(500);
  });

  it('validates every SDK operation against the served schema', () => {
    const failures: string[] = [];
    for (const [name, doc] of operations) {
      const errors = validate(schema, parse(String(doc)));
      if (errors.length > 0) failures.push(`${name}: ${errors[0].message}`);
    }
    expect(failures).toEqual([]);
  });
});
