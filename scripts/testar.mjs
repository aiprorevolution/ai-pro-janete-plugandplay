import { spawnSync } from 'node:child_process';
import path from 'node:path';
const emulator = process.argv[2] === '--firestore';
const args = process.argv.slice(emulator ? 3 : 2);
const env = { ...process.env };
if (emulator) {
  if (!/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(env.FIRESTORE_EMULATOR_HOST || '')) {
    console.error('Inicie o emulador oficial e defina FIRESTORE_EMULATOR_HOST com o endereço local. Nenhum banco da nuvem será usado.');
    process.exit(1);
  }
} else {
  delete env.FIRESTORE_EMULATOR_HOST;
  const preload = path.resolve('scripts/teste-sem-rede.cjs').replaceAll('\\', '/');
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require="${preload}"`.trim();
}
const files = emulator ? ['src/integrations/firebase/rules.emulator.test.ts', 'src/integrations/firebase/rpc-emulator.test.ts'] : [];
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, ...args], { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
