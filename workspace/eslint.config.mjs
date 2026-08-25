import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';

/**
 * Root flat ESLint config for the pwa-app core's single-app workspace.
 * Encodes issue #172 §8's guardrails as build-time (`pnpm lint`)
 * failures. There is no Nx tag graph here (single-project layout, no
 * apps/libs split) — every boundary below is a path-pattern rule
 * instead of a `depConstraints` tag rule.
 *
 * Guardrail reference:
 *   1. src/db (everything under it) is reachable only from a
 *      data/{module}.repository.ts file.
 *   2. No raw `indexedDB` global, no `localStorage` for app state.
 *   3. No deep cross-feature import — only `@/features/{name}` (the
 *      feature's own index.ts barrel) is a valid import target from
 *      outside that feature.
 *   4. No provider SDK import from a feature module — provider access
 *      is confined to integrations/{name}/{client}.client.ts.
 *   5. No non-NEXT_PUBLIC_ env var access in client code.
 *   6. no-floating-promises / no-explicit-any, enforced workspace-wide.
 */
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  { plugins: { '@next/next': nextEslintPluginNext } },
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/.next/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.hedgehog/**',
      '**/test-output/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/vitest.config.*.timestamp*',
      '**/public/sw.js',
    ],
  },
  {
    // Type-aware rules need real type information (`projectService`), so
    // this block is scoped to files that are actually part of the
    // tsconfig project graph — not root-level `.cjs`/`.mjs` tooling
    // config (commitlint.config.cjs, lefthook has none, this file
    // itself), which are plain untyped Node scripts.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message:
            'Raw indexedDB access is forbidden — go through the Dexie instance exported by src/db/database.ts, reached only from a data/*.repository.ts file.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'indexedDB',
          message:
            'Raw indexedDB access is forbidden — go through the Dexie instance exported by src/db/database.ts, reached only from a data/*.repository.ts file.',
        },
        {
          object: 'window',
          property: 'localStorage',
          message:
            'localStorage is forbidden for app state — persist through Dexie (src/db/database.ts). If this is a narrow UI-only preference (e.g. theme), add it to an explicit allowlist here rather than reaching for localStorage ad hoc.',
        },
        {
          object: 'global',
          property: 'localStorage',
          message:
            'localStorage is forbidden for app state — persist through Dexie (src/db/database.ts).',
        },
      ],
    },
  },
  {
    // Every import-path guardrail lives in this ONE no-restricted-imports
    // block. Flat config does not merge rule VALUES across config objects
    // that match the same file — a later block setting the same rule name
    // replaces the earlier block's setting entirely, it does not add to
    // it (confirmed against this exact file: splitting these guardrails
    // across separate blocks silently dropped every one but whichever
    // block ESLint applied last for a given file, even when their `files`/
    // `ignores` differed). One block, one full pattern list, is the only
    // way for all of them to apply together.
    //
    // The exceptions each guardrail needs (a feature's own
    // data/*.repository.ts may import src/db/**; src/db/** itself is
    // exempt from its own rule) are folded into this block's `ignores`
    // rather than expressed as a second block, for the same reason —
    // losing the *other* guardrails (no deep-feature-import, no
    // utils/services) on a repository file is an acceptable trade,
    // since none of those are in tension with what a repository file
    // actually does.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/db/**',
      'src/features/*/data/*.repository.ts',
      '**/*.spec.{ts,tsx}',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/utils/*', '*/utils', '*/helpers/*', '*/helpers', '*/misc/*', '*/misc'],
              message:
                'No utils/, helpers/, or misc/ dumping-ground directories — name the module for what it does and place it under features/{module}/data|hooks|components, integrations/, or components/.',
            },
            {
              group: ['@/services/*', '@/services', '/services/*'],
              message:
                'No top-level services/ directory — domain logic lives in a feature\'s data/ (repository) layer, per this core\'s five-layer build (schema -> repository -> hook -> screen -> join).',
            },
            {
              group: ['@/features/*/*'],
              message:
                'No deep import into another feature. Import the feature\'s own barrel (`@/features/{name}`) — only src/features/{name}/index.ts is a valid cross-feature import target.',
            },
            {
              group: ['@/db', '@/db/*'],
              message:
                'Only a feature\'s data/*.repository.ts file may import src/db/** directly. Reach the database through your feature\'s repository, not from a component, hook, or app route.',
            },
            {
              group: ['@/integrations/*/*'],
              message:
                'A feature never reaches into an integration\'s internals. Provider SDK access is confined to integrations/*/[name].client.ts — import that client\'s public export instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // Guardrail 5: no non-NEXT_PUBLIC_ env var access in client code.
    // Server-only files (route handlers, the manifest/sw routes, and
    // config files evaluated at build time on the server) are exempt.
    // `no-restricted-syntax` (not `no-restricted-properties`) because the
    // rule needs to inspect the *property name string* and allow the
    // NEXT_PUBLIC_ prefix through — `no-restricted-properties` can only
    // blanket-forbid `process.env` itself, which would also forbid the
    // allowed case.
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: [
      '**/route.ts',
      '**/manifest.ts',
      'src/app/sw.ts',
      '**/*.spec.{ts,tsx}',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name!=/^NEXT_PUBLIC_/]",
          message:
            'Client code may only read NEXT_PUBLIC_-prefixed env vars (process.env.NEXT_PUBLIC_X). A non-public var belongs in a server-only file (route handler, server component data fetch).',
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'] > Literal[value!=/^NEXT_PUBLIC_/]",
          message:
            'Client code may only read NEXT_PUBLIC_-prefixed env vars (process.env["NEXT_PUBLIC_X"]). A non-public var belongs in a server-only file (route handler, server component data fetch).',
        },
      ],
    },
  },
  {
    // React/Next linting for app-router and component files.
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{tsx}', 'src/components/**/*.{tsx}'],
    ...nx.configs['flat/react-typescript'][0],
  },
];
