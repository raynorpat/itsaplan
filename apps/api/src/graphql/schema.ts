import { readFileSync } from 'node:fs';
import { clearLoaders } from './loaders';
import { makeExecutableSchema, type IExecutableSchemaDefinition } from '@graphql-tools/schema';
import {
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  type GraphQLField,
  type GraphQLOutputType,
  type GraphQLSchema,
} from 'graphql';
import { gqlError } from './errors';

// Linear's published schema, served unmodified (see SCHEMA_SOURCE.md).
const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');

type Resolvers = NonNullable<IExecutableSchemaDefinition['resolvers']>;

// The neutral value for a field this app has no data for: null when the field is
// nullable, otherwise an empty list, '', 0, false, {} for JSON, the epoch for a
// date, the first enum value, or an empty object whose own fields resolve the same
// way. This lets the Linear SDK's fragments, which select nearly every field of a
// type, resolve on types that are only partly implemented.
function neutral(type: GraphQLOutputType): unknown {
  if (!isNonNullType(type)) return null;
  const inner = type.ofType;
  if (isListType(inner)) return [];
  if (isEnumType(inner)) return inner.getValues()[0]?.value ?? null;
  if (isScalarType(inner)) {
    switch (inner.name) {
      case 'Int':
      case 'Float':
        return 0;
      case 'Boolean':
        return false;
      case 'JSON':
      case 'JSONObject':
        return {};
      case 'DateTime':
        return new Date(0).toISOString();
      case 'TimelessDate':
        return '1970-01-01';
      default:
        return '';
    }
  }
  return {};
}

// A field resolver that reads the parent's property, falling back to the neutral
// value when the property is absent.
function defaultField(field: GraphQLField<unknown, unknown>) {
  return (parent: Record<string, unknown>) => {
    const value = parent?.[field.name];
    return value === undefined ? neutral(field.type) : value;
  };
}

// Builds the executable schema from Linear's SDL and the given resolvers. A root
// Query or Mutation field without a resolver answers NOT_IMPLEMENTED; any other
// field without one reads its parent's property, or the neutral value.
export function buildSchema(resolvers: Resolvers): GraphQLSchema {
  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const roots = new Set([schema.getQueryType()?.name, schema.getMutationType()?.name]);
  const mutationType = schema.getMutationType()?.name;
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue;
    for (const field of Object.values(type.getFields())) {
      if (field.resolve && type.name === mutationType) {
        // Each mutation field starts with fresh loaders (see clearLoaders).
        const resolve = field.resolve;
        field.resolve = (source, args, ctx, info) => {
          clearLoaders(ctx);
          return resolve(source, args, ctx, info);
        };
        continue;
      }
      if (field.resolve) continue;
      field.resolve = roots.has(type.name)
        ? () => {
            throw gqlError('NOT_IMPLEMENTED', `${field.name} is not implemented`);
          }
        : defaultField(field);
    }
  }
  return schema;
}
