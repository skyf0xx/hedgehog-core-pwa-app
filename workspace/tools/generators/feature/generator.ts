import { formatFiles } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { assertUsableName, moduleNames } from '../naming.ts';
import type { ModuleNames } from '../naming.ts';
import { existingTableNames, registerTableInSchema, writeTableFile } from '../db-tables.ts';
import {
  dexieRepositoryFile,
  dexieRepositorySpecFile,
  fixtureFile,
  schemaFile,
  schemaSpecFile,
} from '../templates.ts';

type Layer = 'schema' | 'repository' | 'hook' | 'screen';

interface FeatureGeneratorOptions {
  name: string;
  layer?: Layer;
}

/**
 * The vertical slice for one domain module, matching core.yaml's
 * schema -> repository -> hook -> screen layers. `--layer` emits only
 * the files that layer's scope allows, each with the spec its verify
 * command runs; a later layer refuses until the layer before it has
 * landed. Without `--layer` it emits the whole slice for a new module.
 */
export default async function featureGenerator(tree: Tree, options: FeatureGeneratorOptions) {
  const names = moduleNames(options.name);
  const dir = `src/features/${names.module}`;
  const paths = {
    schema: `${dir}/data/${names.module}.schema.ts`,
    repository: `${dir}/data/${names.module}.repository.ts`,
    hook: `${dir}/hooks/use-${names.module}.ts`,
    screen: `${dir}/components/${names.entityPascal}List.tsx`,
  };

  if (options.layer === undefined) {
    assertUsableName(options.name, existingTableNames(tree));
    if (tree.exists(dir)) {
      throw new Error(`${dir} already exists. Pass --layer to add one layer to it.`);
    }
    writeSchemaLayer(tree, names, dir);
    writeRepositoryLayer(tree, names, dir);
    writeHookLayer(tree, names, dir);
    writeScreenLayer(tree, names, dir);
  } else {
    const previous: Record<Layer, Layer | undefined> = {
      schema: undefined,
      repository: 'schema',
      hook: 'repository',
      screen: 'hook',
    };
    const before = previous[options.layer];
    if (before && !tree.exists(paths[before])) {
      throw new Error(`${paths[before]} does not exist. Run this generator with --layer=${before} first.`);
    }
    if (tree.exists(paths[options.layer])) {
      throw new Error(`${paths[options.layer]} already exists.`);
    }
    if (options.layer === 'schema') {
      assertUsableName(options.name, existingTableNames(tree));
      writeSchemaLayer(tree, names, dir);
    }
    if (options.layer === 'repository') writeRepositoryLayer(tree, names, dir);
    if (options.layer === 'hook') writeHookLayer(tree, names, dir);
    if (options.layer === 'screen') writeScreenLayer(tree, names, dir);
  }

  await formatFiles(tree);
}

function writeSchemaLayer(tree: Tree, names: ModuleNames, dir: string) {
  writeTableFile(tree, names.module, names.camel);
  registerTableInSchema(tree, names.module);
  tree.write(`${dir}/data/${names.module}.schema.ts`, schemaFile(names));
  tree.write(`${dir}/data/${names.module}.schema.spec.ts`, schemaSpecFile(names));
}

function writeRepositoryLayer(tree: Tree, names: ModuleNames, dir: string) {
  tree.write(`${dir}/data/${names.module}.fixture.ts`, fixtureFile(names));
  tree.write(`${dir}/data/${names.module}.repository.ts`, dexieRepositoryFile(names));
  tree.write(`${dir}/data/${names.module}.repository.spec.ts`, dexieRepositorySpecFile(names));
}

function writeHookLayer(tree: Tree, names: ModuleNames, dir: string) {
  tree.write(`${dir}/hooks/use-${names.module}.ts`, hookFile(names));
  tree.write(`${dir}/hooks/use-${names.module}.spec.tsx`, hookSpecFile(names));
}

function writeScreenLayer(tree: Tree, names: ModuleNames, dir: string) {
  tree.write(`${dir}/components/${names.entityPascal}List.tsx`, componentFile(names));
  tree.write(`${dir}/components/${names.entityPascal}List.spec.tsx`, componentSpecFile(names));
  tree.write(`${dir}/index.ts`, barrelFile(names));
}

function hookFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ${entityPascal}Repository } from '../data/${module}.repository';
import type { Create${entityPascal}, Update${entityPascal} } from '../data/${module}.schema';

const ${names.camel}Keys = {
  all: () => ['${module}'] as const,
  detail: (id: string) => ['${module}', 'detail', id] as const,
};

/** The list query every ${module} component reads from. */
export function use${pascal}() {
  return useQuery({
    queryKey: ${names.camel}Keys.all(),
    queryFn: () => ${entityPascal}Repository.list(),
  });
}

/** Named ById rather than use${entityPascal} — a plural-less module name (e.g. "smoketest") would otherwise collide with the list hook above. */
export function use${entityPascal}ById(id: string) {
  return useQuery({
    queryKey: ${names.camel}Keys.detail(id),
    queryFn: () => ${entityPascal}Repository.get(id),
    enabled: id.length > 0,
  });
}

export function useCreate${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Create${entityPascal}) => ${entityPascal}Repository.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}

export function useUpdate${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Update${entityPascal} }) =>
      ${entityPascal}Repository.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}

export function useDelete${entityPascal}() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ${entityPascal}Repository.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ${names.camel}Keys.all() });
    },
  });
}
`;
}

function hookSpecFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create${entityPascal}Fixture } from '../data/${module}.fixture';
import { ${entityPascal}Repository } from '../data/${module}.repository';
import {
  use${pascal},
  use${entityPascal}ById,
  useCreate${entityPascal},
  useDelete${entityPascal},
  useUpdate${entityPascal},
} from './use-${module}';

// The hooks are tested against a mocked repository, so this spec is the
// same whether the repository is Dexie- or Supabase-backed.
vi.mock('../data/${module}.repository', () => ({
  ${entityPascal}Repository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const repository = vi.mocked(${entityPascal}Repository);

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('use-${module} hooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists through the repository', async () => {
    const row = create${entityPascal}Fixture();
    repository.list.mockResolvedValue([row]);

    const { result } = renderHook(() => use${pascal}(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([row]);
  });

  it('surfaces a repository failure as an error state', async () => {
    repository.list.mockRejectedValue(new Error('list failed'));

    const { result } = renderHook(() => use${pascal}(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('skips the detail query for an empty id', () => {
    const { result } = renderHook(() => use${entityPascal}ById(''), { wrapper: wrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(repository.get).not.toHaveBeenCalled();
  });

  it('creates, updates, and deletes through the repository, refetching the list', async () => {
    const row = create${entityPascal}Fixture();
    repository.list.mockResolvedValue([]);
    repository.create.mockResolvedValue(row);
    repository.update.mockResolvedValue(row);
    repository.delete.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => ({
        list: use${pascal}(),
        create: useCreate${entityPascal}(),
        update: useUpdate${entityPascal}(),
        remove: useDelete${entityPascal}(),
      }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({}));
    await act(() => result.current.update.mutateAsync({ id: row.id, input: {} }));
    await act(() => result.current.remove.mutateAsync(row.id));

    expect(repository.create).toHaveBeenCalledWith({});
    expect(repository.update).toHaveBeenCalledWith(row.id, {});
    expect(repository.delete).toHaveBeenCalledWith(row.id);
    await waitFor(() => expect(repository.list.mock.calls.length).toBeGreaterThan(1));
  });
});
`;
}

function componentFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `'use client';

import { use${pascal} } from '../hooks/use-${module}';

/**
 * Minimal shell proving the hook layer is wired end to end. Replace with
 * the module's real presentation once the domain shape is filled in.
 */
export function ${entityPascal}List() {
  const { data, isLoading, isError } = use${pascal}();

  if (isLoading) return <p>Loading ${module}...</p>;
  if (isError) return <p>Could not load ${module}.</p>;
  if (!data || data.length === 0) return <p>No ${module} yet.</p>;

  return (
    <ul>
      {data.map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  );
}
`;
}

function componentSpecFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create${entityPascal}Fixture } from '../data/${module}.fixture';
import { use${pascal} } from '../hooks/use-${module}';
import { ${entityPascal}List } from './${entityPascal}List';

vi.mock('../hooks/use-${module}', () => ({ use${pascal}: vi.fn() }));

const useList = vi.mocked(use${pascal});

type ListState = ReturnType<typeof use${pascal}>;

function listState(state: Partial<ListState>): ListState {
  return { data: undefined, isLoading: false, isError: false, ...state } as unknown as ListState;
}

describe('${entityPascal}List', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows the loading state', () => {
    useList.mockReturnValue(listState({ isLoading: true }));
    render(<${entityPascal}List />);
    expect(screen.getByText('Loading ${module}...')).toBeInTheDocument();
  });

  it('shows the error state', () => {
    useList.mockReturnValue(listState({ isError: true }));
    render(<${entityPascal}List />);
    expect(screen.getByText('Could not load ${module}.')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    useList.mockReturnValue(listState({ data: [] }));
    render(<${entityPascal}List />);
    expect(screen.getByText('No ${module} yet.')).toBeInTheDocument();
  });

  it('renders one item per row', () => {
    const rows = [create${entityPascal}Fixture(), create${entityPascal}Fixture()];
    useList.mockReturnValue(listState({ data: rows }));
    render(<${entityPascal}List />);
    expect(screen.getAllByRole('listitem')).toHaveLength(rows.length);
  });
});
`;
}

function barrelFile(names: ModuleNames): string {
  const { entityPascal, pascal, module } = names;

  return `/**
 * This feature's only valid cross-feature import path
 * (\`@/features/${module}\`) — the eslint no-deep-import guardrail rejects
 * anything reaching past this file into data/, hooks/, or components/
 * directly. The repository and schema stay data/-only.
 */
export { use${pascal}, use${entityPascal}ById, useCreate${entityPascal}, useUpdate${entityPascal}, useDelete${entityPascal} } from './hooks/use-${module}';
export { ${entityPascal}List } from './components/${entityPascal}List';
`;
}
