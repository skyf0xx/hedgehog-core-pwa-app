#!/usr/bin/env node
// Runs the generators into a workspace one layer at a time and runs each
// layer's verify command from that workspace's core.yaml on the output,
// then join's. Writes into the workspace it is given: run it on a
// throwaway copy or a CI checkout. Usage: node scripts/check-generators.mjs [workspace-dir]
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cwd = process.argv[2] ?? 'workspace';
const coreYaml = readFileSync(`${cwd}/core.yaml`, 'utf8');
const verify = Object.fromEntries(
  [...coreYaml.matchAll(/- id: (\w+)[\s\S]*?verify: "([^"]+)"/g)].map((match) => [match[1], match[2]]),
);

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function layer(module, generator, id) {
  run(`pnpm generate @hedgehog/pwa:${generator} --no-interactive`);
  run(verify[id].replaceAll('{module}', module));
}

for (const id of ['schema', 'repository', 'hook', 'screen']) {
  layer('ci-todos', `feature ci-todos --layer=${id}`, id);
}

layer('ci-notes', 'entity ci-notes --remote --layer=schema', 'schema');
layer('ci-notes', 'entity ci-notes --remote --layer=repository', 'repository');
layer('ci-notes', 'feature ci-notes --layer=hook', 'hook');
layer('ci-notes', 'feature ci-notes --layer=screen', 'screen');

run('pnpm add -w --ignore-scripts @supabase/supabase-js@2');
run(verify.join);
