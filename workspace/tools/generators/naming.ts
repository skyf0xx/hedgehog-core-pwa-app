/**
 * Every name a generator derives from one module/entity name, in one
 * place — mirrors `hedgehog-core-full-stack-app`'s own
 * `tools/generators/naming.ts`, adapted to this workspace's single-app,
 * `src/features/{module}` layout (no Postgres table name, no NestJS
 * class prefix; a Dexie table name instead).
 *
 * A domain module is one feature directory, named in plural kebab-case
 * (`todos`, `order-items`). The entity name is its singular form, used
 * for the Zod type, the repository class, and the hook names.
 */

const RESERVED_NAMES = new Set([
  'schema',
  'db',
  'index',
  'database',
  'errors',
  'types',
  'export',
  'persistence',
  'app',
  'components',
  'hooks',
  'data',
  'features',
  'integrations',
]);

export interface ModuleNames {
  /** `order-items` — the module name, and `src/features/{module}`'s directory. */
  module: string;
  /** `orderItems` — the Dexie table name and query-key root. */
  camel: string;
  /** `OrderItems` — plural Pascal, for the hook's list-query function name. */
  pascal: string;
  /** `order-item` — singular kebab, for a singular file name. */
  entityKebab: string;
  /** `orderItem` — singular camel, for a variable name. */
  entityCamel: string;
  /** `OrderItem` — singular Pascal, for the entity type, repository class, and component name. */
  entityPascal: string;
  /** `ORDER_ITEM` — singular constant case. */
  entityConstant: string;
}

export function moduleNames(module: string): ModuleNames {
  const normalized = module.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      `Name "${module}" must be lower kebab-case (e.g. todos, order-items).`,
    );
  }

  const segments = normalized.split('-');
  const entitySegments = segments.map((segment, index) =>
    index === segments.length - 1 ? singular(segment) : segment,
  );

  return {
    module: normalized,
    camel: toCamel(segments),
    pascal: toPascal(segments),
    entityKebab: entitySegments.join('-'),
    entityCamel: toCamel(entitySegments),
    entityPascal: toPascal(entitySegments),
    entityConstant: entitySegments.join('_').toUpperCase(),
  };
}

/**
 * Guards a name against colliding with an existing Dexie table or a
 * reserved word (`entity` generator's refusal rule — issue #172 §7).
 * `existingTables` is the set of table names already registered in
 * `src/db/tables/*.table.ts`.
 */
export function assertUsableName(module: string, existingTables: Set<string>) {
  const normalized = module.trim().toLowerCase();
  if (RESERVED_NAMES.has(normalized)) {
    throw new Error(
      `"${module}" is a reserved name and cannot be used for a module or entity. Reserved: ${[...RESERVED_NAMES].join(', ')}.`,
    );
  }
  const { camel } = moduleNames(module);
  if (existingTables.has(camel)) {
    throw new Error(
      `A table named "${camel}" is already registered in src/db/tables/. Choose a different name, or use the "entity" generator with --feature to add a second entity to the existing "${module}" feature.`,
    );
  }
}

function toCamel(segments: string[]): string {
  return segments
    .map((segment, index) => (index === 0 ? segment : capitalize(segment)))
    .join('');
}

function toPascal(segments: string[]): string {
  return segments.map(capitalize).join('');
}

function capitalize(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * English plural-to-singular for the shapes a module name actually
 * takes. A module whose singular this gets wrong is a rename away from
 * correct — cosmetic, not load-bearing.
 */
function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(s|x|z|ch|sh)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}
