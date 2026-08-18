import type { Tree } from '@nx/devkit';

const TABLES_DIR = 'src/db/tables';
const SCHEMA_BARREL = 'src/db/schema.ts';

const IMPORT_MARKER =
  "// GENERATOR: import each module's table module here, one line per";
const VERSION_MARKER =
  "// GENERATOR: chain that module's version().stores() call onto";

/**
 * Every existing `src/db/tables/*.table.ts` file's exported `version`,
 * read straight from source text (the tree may hold uncommitted writes
 * from earlier in the same generator run, so this deliberately does not
 * shell out to a compiled build). The next module's version is
 * `max(existing) + 1`, or `1` if none exist yet — the exact mechanism
 * issue #172 §4/§9 requires so two modules landing in parallel never
 * claim the same Dexie version number.
 */
export function nextTableVersion(tree: Tree): number {
  if (!tree.exists(TABLES_DIR)) return 1;

  const versions = tree
    .children(TABLES_DIR)
    .filter((name) => name.endsWith('.table.ts'))
    .map((name) => {
      const content = tree.read(`${TABLES_DIR}/${name}`, 'utf-8') ?? '';
      const match = content.match(/export const version = (\d+)/);
      return match ? Number(match[1]) : 0;
    });

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

/** Every Dexie table name already registered, for the `entity` generator's collision check. */
export function existingTableNames(tree: Tree): Set<string> {
  if (!tree.exists(TABLES_DIR)) return new Set();

  const names = tree
    .children(TABLES_DIR)
    .filter((name) => name.endsWith('.table.ts'))
    .map((name) => {
      const content = tree.read(`${TABLES_DIR}/${name}`, 'utf-8') ?? '';
      const match = content.match(/export const tableName = '([^']+)'/);
      return match?.[1];
    })
    .filter((name): name is string => Boolean(name));

  return new Set(names);
}

/**
 * Writes `src/db/tables/{module}.table.ts` — table name, Dexie index
 * string, and the version it was introduced at. `@id` (sharded
 * auto-generated string primary key) plus indexed `realmId`/`owner`
 * (the `Syncable` fields) so the table is sync-ready from its first
 * version, per issue #172 §9.
 */
export function writeTableFile(
  tree: Tree,
  module: string,
  camel: string,
  extraIndexes: string[] = [],
): number {
  const version = nextTableVersion(tree);
  const indexes = ['id', 'realmId', 'owner', ...extraIndexes].join(', ');

  tree.write(
    `${TABLES_DIR}/${module}.table.ts`,
    `/**
 * Dexie table registration for the "${module}" module, appended to
 * \`src/db/schema.ts\`'s version chain at generation time. Introduced at
 * version ${version} — do not edit this number after this module ships;
 * a later schema change to this table is a new, higher version with its
 * own upgrade function, never a rewrite of this one.
 */
export const tableName = '${camel}';

/**
 * A plain, non-auto-increment string primary key, client-generated
 * (the repository calls \`crypto.randomUUID()\` before \`add()\`) —
 * sync-ready in the sense that matters (a collision-free string id set
 * before the row is written, never a numeric auto-increment key, which
 * cannot be adopted by Dexie Cloud after data exists). \`@id\`, Dexie
 * Cloud's own sharded-key marker, is dexie-cloud-addon syntax: the
 * addon intercepts \`.stores()\` and rewrites \`@id\` before core Dexie
 * ever sees it, so plain Dexie (the default here — the addon is
 * intentionally not installed, per issue #172 §9) treats \`@id\`
 * literally as a keyPath, which IndexedDB rejects. Turning sync on
 * later is a one-line change to this file, \`id\` -> \`@id\`, once
 * dexie-cloud-addon is installed and registered — no data migration,
 * because the id values themselves are already the right shape.
 * \`realmId\` and \`owner\` are the \`Syncable\` fields every syncable
 * table carries, indexed so a realm-scoped query does not table-scan.
 */
export const schema = '${indexes}';

export const version = ${version};
`,
  );

  return version;
}

/**
 * Appends this module's import + `.version().stores()` line to
 * `src/db/schema.ts`'s `applySchema` function, anchored on the two
 * `// GENERATOR:` marker comments that file documents as the stable
 * append point. Idempotent — re-running for the same module is a no-op.
 */
export function registerTableInSchema(tree: Tree, module: string) {
  const content = tree.read(SCHEMA_BARREL, 'utf-8');
  if (content === null) {
    throw new Error(`${SCHEMA_BARREL} not found — is this the pwa-app workspace root?`);
  }

  const importLine = `import * as ${camelModule(module)} from './tables/${module}.table';`;
  const storesLine = `  db.version(${camelModule(module)}.version).stores({ [${camelModule(module)}.tableName]: ${camelModule(module)}.schema });`;

  if (content.includes(importLine)) return;

  let next = content;

  if (!next.includes(IMPORT_MARKER)) {
    throw new Error(
      `${SCHEMA_BARREL} is missing its "${IMPORT_MARKER}" marker comment — cannot anchor the generated import.`,
    );
  }
  next = insertAfterLineContaining(next, IMPORT_MARKER, importLine);

  if (!next.includes(VERSION_MARKER)) {
    throw new Error(
      `${SCHEMA_BARREL} is missing its "${VERSION_MARKER}" marker comment — cannot anchor the generated version chain.`,
    );
  }
  next = insertVersionChainCall(next, storesLine);

  tree.write(SCHEMA_BARREL, next);
}

function camelModule(module: string): string {
  return module.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/**
 * Inserts `line` as the first statement of the file, directly above the
 * `import type { Dexie }` line — imports must precede the function body,
 * so this anchors on the top of the file rather than under the marker
 * comment itself (the marker sits inside the function's doc comment,
 * above `applySchema`, not above the top-of-file import block).
 */
function insertAfterLineContaining(content: string, _marker: string, importLine: string): string {
  const lines = content.split('\n');
  const importIndex = lines.findIndex((line) => line.startsWith("import type { Dexie }"));
  const insertAt = importIndex === -1 ? 0 : importIndex + 1;
  lines.splice(insertAt, 0, importLine);
  return lines.join('\n');
}

/**
 * Inserts `storesLine` as the last statement inside `applySchema`,
 * directly above its closing brace, replacing the placeholder
 * `db.version(1).stores({});` the very first module encounters.
 */
function insertVersionChainCall(content: string, storesLine: string): string {
  const placeholder = '  db.version(1).stores({});';
  if (content.includes(placeholder)) {
    return content.replace(placeholder, storesLine);
  }

  const lines = content.split('\n');
  const closeIndex = lines.findIndex((line) => line.trim() === '}');
  if (closeIndex === -1) {
    throw new Error(`Could not find applySchema's closing brace in ${SCHEMA_BARREL}.`);
  }
  lines.splice(closeIndex, 0, storesLine);
  return lines.join('\n');
}
