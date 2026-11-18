import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const HASH = 'a'.repeat(64);

const SUBSYSTEMS = {
  billing: {
    schema: 'firetree.subsystem/v1',
    id: 'billing',
    name: 'Billing',
    paths: ['services/billing/**', 'contracts/billing/**'],
    owners: ['@team-billing'],
    interfaces: ['billing.api'],
    tests: ['billing/unit', 'billing/contract'],
    depends_on: ['checkout'],
    dossier: {
      path: '.firetree/oid/billing.json',
      sha256: HASH,
      kind: 'large',
      method: 'decompose',
      updated_at: '2026-11-07T00:00:00Z',
    },
  },
  checkout: {
    schema: 'firetree.subsystem/v1',
    id: 'checkout',
    name: 'Checkout',
    paths: ['services/checkout/**'],
    owners: ['@team-checkout'],
    interfaces: ['billing.api'],
    tests: ['checkout/integration'],
    depends_on: ['billing'],
    dossier: {
      path: '.firetree/oid/checkout.json',
      sha256: HASH,
      kind: 'large',
      method: 'decompose',
      updated_at: '2026-11-07T00:00:00Z',
    },
  },
  docs: {
    schema: 'firetree.subsystem/v1',
    id: 'docs',
    name: 'Documentation',
    paths: ['docs/**'],
    owners: ['@team-docs'],
    interfaces: [],
    tests: [],
    dossier: {
      path: '.firetree/oid/docs.json',
      sha256: HASH,
      kind: 'simple',
      method: 'decompose',
      updated_at: '2026-11-07T00:00:00Z',
    },
  },
};

const INTERFACE = {
  schema: 'firetree.interface/v1',
  id: 'billing.api',
  kind: 'openapi',
  file: 'contracts/billing/openapi.yaml',
  sha256: HASH,
  contract_test: 'tests/contract/billing.spec.mjs',
  consumers: ['checkout'],
  depends_on: [],
};

const CODEOWNERS = [
  '* @team-core',
  '/services/billing/ @team-billing',
  'services/checkout/** @team-checkout',
  'docs/** @team-docs',
  '*.md @team-docs',
  '',
].join('\n');

/**
 * Create an isolated M1 workspace with policy, registries, CODEOWNERS, and source files.
 *
 * @param {{parent?: string}} [options] - Optional parent directory.
 * @returns {Promise<{root: string, cleanup: () => Promise<void>}>} Workspace handle.
 */
export async function createM1Workspace(options = {}) {
  const parent = options.parent ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'firetree-m1-'));
  const policy = JSON.parse(await readFile(new URL('../fixtures/policy-org.json', import.meta.url), 'utf8'));

  const files = {
    '.firetree/policy.json': JSON.stringify(policy, null, 2),
    '.firetree/subsystems/billing.json': JSON.stringify(SUBSYSTEMS.billing, null, 2),
    '.firetree/subsystems/checkout.json': JSON.stringify(SUBSYSTEMS.checkout, null, 2),
    '.firetree/subsystems/docs.json': JSON.stringify(SUBSYSTEMS.docs, null, 2),
    '.firetree/interfaces/billing.api.json': JSON.stringify(INTERFACE, null, 2),
    'CODEOWNERS': CODEOWNERS,
    'services/billing/charge.mjs': 'export const charge = true;\n',
    'services/checkout/cart.mjs': 'export const cart = true;\n',
    'contracts/billing/openapi.yaml': 'openapi: 3.1.0\n',
    'docs/README.md': '# Docs\n',
    'tests/billing/charge.test.mjs': '// test\n',
    'tests/contract/billing.spec.mjs': '// contract test\n',
    'package.json': '{"name":"m1-fixture","private":true}\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const file = join(root, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
