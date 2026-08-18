import { formatFiles } from '@nx/devkit';
import type { Tree } from '@nx/devkit';
import { moduleNames } from '../naming.ts';
import type { ModuleNames } from '../naming.ts';

interface IntegrationGeneratorOptions {
  name: string;
  kind?: 'client' | 'wallet';
}

/**
 * Client/schema/adapter triple for one external integration (issue
 * #172 §7). `--kind=wallet` emits the AuthProvider/WalletProvider stub
 * pair from §11 instead — a fixed contract the invoking agent fills in
 * with a real provider (Privy/Dynamic/etc); this generator does not
 * pick one.
 */
export default async function integrationGenerator(tree: Tree, options: IntegrationGeneratorOptions) {
  const names = moduleNames(options.name);
  const dir = `src/integrations/${names.module}`;

  if (tree.exists(dir)) {
    throw new Error(`src/integrations/${names.module} already exists.`);
  }

  tree.write(`${dir}/integration-error.ts`, integrationErrorFile());

  if (options.kind === 'wallet') {
    tree.write(`${dir}/${names.module}.client.ts`, walletClientFile(names));
    tree.write(`${dir}/${names.module}.adapter.ts`, walletAdapterFile(names));
    tree.write(`${dir}/${names.module}.adapter.spec.ts`, walletAdapterSpecFile(names));
    tree.write(`${dir}/index.ts`, walletBarrelFile(names));
  } else {
    tree.write(`${dir}/${names.module}.client.ts`, clientFile(names));
    tree.write(`${dir}/${names.module}.schema.ts`, schemaFile(names));
    tree.write(`${dir}/${names.module}.adapter.ts`, adapterFile(names));
    tree.write(`${dir}/${names.module}.adapter.spec.ts`, adapterSpecFile(names));
    tree.write(`${dir}/index.ts`, barrelFile(names));
  }

  await formatFiles(tree);
}

/**
 * A local, integration-scoped error constructor shaped exactly like
 * src/db/errors.ts's AppError (same `kind`/`message`/`cause` fields, so
 * `isAppError()` recognizes it and a caller can branch on `kind`
 * identically) without importing across it — eslint.config.mjs's
 * no-restricted-imports guardrail confines `@/db/**` to a feature's own
 * `data/*.repository.ts`, and an integration adapter is deliberately
 * outside that allowance (issue #172 §8: only a repository reaches the
 * database; an integration reaches an external API instead, through its
 * own error type at the same shape).
 */
function integrationErrorFile(): string {
  return `export type IntegrationErrorKind = 'network' | 'provider';

export interface IntegrationError {
  kind: IntegrationErrorKind;
  message: string;
  cause?: unknown;
}

function makeError(kind: IntegrationErrorKind) {
  return (message: string, cause?: unknown): IntegrationError => ({ kind, message, cause });
}

/** A fetch/HTTP failure reaching this integration's own client. */
export const networkError = makeError('network');
/** A failure surfaced by the provider itself, including a response that fails schema validation. */
export const providerError = makeError('provider');
`;
}

function clientFile(names: ModuleNames): string {
  const { pascal } = names;

  return `/**
 * The only file allowed to import a provider SDK for the "${names.module}"
 * integration — enforced by eslint.config.mjs's no-restricted-imports
 * guardrail (no feature, hook, or component may import a provider SDK
 * directly; issue #172 §8).
 *
 * Replace the body of \`fetch${pascal}\` with the real provider/HTTP call.
 * It returns the raw, unvalidated response — validation happens in
 * ${names.module}.adapter.ts, never here.
 */
export async function fetch${pascal}(): Promise<unknown> {
  const response = await fetch(\`https://example.invalid/${names.module}\`);
  if (!response.ok) {
    throw new Error(\`${pascal} request failed with status \${response.status}.\`);
  }
  return response.json();
}
`;
}

function schemaFile(names: ModuleNames): string {
  const { pascal } = names;

  return `import { z } from 'zod';

/**
 * Response shape for the "${names.module}" integration. Replace with the
 * real provider's response shape — this is a minimal, typechecking
 * skeleton the adapter validates every response against.
 */
export const ${pascal}ResponseSchema = z.object({
  id: z.string(),
});

export type ${pascal}Response = z.infer<typeof ${pascal}ResponseSchema>;
`;
}

function adapterFile(names: ModuleNames): string {
  const { pascal, module } = names;

  return `import { networkError, providerError } from './integration-error';
import { fetch${pascal} } from './${module}.client';
import { ${pascal}ResponseSchema, type ${pascal}Response } from './${module}.schema';

/**
 * Maps the client's raw response through the Zod schema, returning
 * typed data or throwing a discriminated AppError — never the client's
 * raw error or a bare Error (issue #172 §14).
 */
export async function get${pascal}(): Promise<${pascal}Response> {
  let raw: unknown;
  try {
    raw = await fetch${pascal}();
  } catch (cause) {
    throw networkError('Failed to reach the ${module} integration.', cause);
  }

  const parsed = ${pascal}ResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw providerError('${pascal} response failed schema validation.', parsed.error);
  }
  return parsed.data;
}
`;
}

function adapterSpecFile(names: ModuleNames): string {
  const { pascal, module } = names;

  return `import { describe, expect, it, vi } from 'vitest';

vi.mock('./${module}.client', () => ({
  fetch${pascal}: vi.fn(),
}));

describe('get${pascal}', () => {
  it('returns typed data for a valid response', async () => {
    const { fetch${pascal} } = await import('./${module}.client');
    vi.mocked(fetch${pascal}).mockResolvedValue({ id: 'abc' });

    const { get${pascal} } = await import('./${module}.adapter');
    await expect(get${pascal}()).resolves.toEqual({ id: 'abc' });
  });

  it('throws a providerError when the response fails schema validation', async () => {
    const { fetch${pascal} } = await import('./${module}.client');
    vi.mocked(fetch${pascal}).mockResolvedValue({ nope: true });

    const { get${pascal} } = await import('./${module}.adapter');
    await expect(get${pascal}()).rejects.toMatchObject({ kind: 'provider' });
  });

  it('throws a networkError when the client rejects', async () => {
    const { fetch${pascal} } = await import('./${module}.client');
    vi.mocked(fetch${pascal}).mockRejectedValue(new Error('offline'));

    const { get${pascal} } = await import('./${module}.adapter');
    await expect(get${pascal}()).rejects.toMatchObject({ kind: 'network' });
  });
});
`;
}

function barrelFile(names: ModuleNames): string {
  const { pascal, module } = names;

  return `export { get${pascal} } from './${module}.adapter';
export type { ${pascal}Response } from './${module}.schema';
`;
}

/**
 * The AuthProvider/WalletProvider contract from issue #172 §11, verbatim.
 * A stub the invoking agent fills in with a real provider (Privy,
 * Dynamic, etc) — this generator does not pick one.
 */
function walletClientFile(names: ModuleNames): string {
  const { pascal } = names;

  return `/**
 * The only file allowed to import a wallet/auth provider SDK for the
 * "${names.module}" integration (issue #172 §8/§11). Wire the real
 * provider's client here (Privy, Dynamic, or similar embedded-wallet
 * provider) — this generator emits the contract shape only.
 */
export interface ${pascal}ClientConfig {
  appId: string;
}

/** Replace with the real provider SDK's client construction. */
export function create${pascal}Client(_config: ${pascal}ClientConfig): unknown {
  throw new Error('${pascal} client is a stub — wire the real provider SDK here.');
}
`;
}

function walletAdapterFile(names: ModuleNames): string {
  const { pascal } = names;

  return `import { providerError } from './integration-error';

/**
 * Fixed shape every wallet integration implements (issue #172 §11).
 * A component reading auth state never knows or cares whether the
 * identity behind it is a Dexie Cloud user or a wallet session — this
 * is the same isolation §9's db.cloud.currentUser adapter follows.
 */
export interface User {
  id: string;
  email?: string;
}

export interface AuthProvider {
  getCurrentUser(): Promise<User | null>;
  signIn(): Promise<User>;
  signOut(): Promise<void>;
}

export interface TransactionRequest {
  to: string;
  value: string;
  data?: string;
}

export interface TransactionResult {
  hash: string;
}

export interface WalletProvider {
  getAddress(): Promise<string | null>;
  signMessage(message: string): Promise<string>;
  sendTransaction(input: TransactionRequest): Promise<TransactionResult>;
}

/**
 * Stub implementation of both interfaces, provider-native by default
 * (issue #172 §11 — chained identity through an existing JWT issuer is
 * only wired when intake names one to preserve). Every method throws
 * providerError until the real provider SDK is wired in ${names.module}.client.ts.
 */
export const ${pascal}Provider: AuthProvider & WalletProvider = {
  async getCurrentUser() {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
  async signIn() {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
  async signOut() {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
  async getAddress() {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
  async signMessage(_message: string) {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
  async sendTransaction(_input: TransactionRequest) {
    throw providerError('${pascal} provider is a stub — wire the real provider SDK in ${names.module}.client.ts.');
  },
};
`;
}

function walletAdapterSpecFile(names: ModuleNames): string {
  const { pascal, module } = names;

  return `import { describe, expect, it } from 'vitest';
import { ${pascal}Provider } from './${module}.adapter';

describe('${pascal}Provider', () => {
  it('implements every AuthProvider and WalletProvider method as a stub', async () => {
    await expect(${pascal}Provider.getCurrentUser()).rejects.toMatchObject({ kind: 'provider' });
    await expect(${pascal}Provider.signIn()).rejects.toMatchObject({ kind: 'provider' });
    await expect(${pascal}Provider.signOut()).rejects.toMatchObject({ kind: 'provider' });
    await expect(${pascal}Provider.getAddress()).rejects.toMatchObject({ kind: 'provider' });
    await expect(${pascal}Provider.signMessage('hello')).rejects.toMatchObject({ kind: 'provider' });
    await expect(
      ${pascal}Provider.sendTransaction({ to: '0x0', value: '0' }),
    ).rejects.toMatchObject({ kind: 'provider' });
  });
});
`;
}

function walletBarrelFile(names: ModuleNames): string {
  const { pascal, module } = names;

  return `export { ${pascal}Provider } from './${module}.adapter';
export type { AuthProvider, TransactionRequest, TransactionResult, User, WalletProvider } from './${module}.adapter';
export { create${pascal}Client } from './${module}.client';
export type { ${pascal}ClientConfig } from './${module}.client';
`;
}
