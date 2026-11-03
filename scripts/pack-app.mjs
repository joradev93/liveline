/**
 * Prepares a deployable folder for one Node service:
 *   dist/ (tsup bundle, workspace packages already inside) + package.json with only the
 *   external runtime dependencies (exact versions from the app's package.json).
 *
 *   node scripts/pack-app.mjs gateway /out && cd /out && npm install --omit=dev
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [app, out] = process.argv.slice(2);
if (!app || !out) throw new Error('usage: node scripts/pack-app.mjs <app> <outDir>');

const dir = new URL(`../apps/${app}/`, import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const dependencies = Object.fromEntries(
  Object.entries(pkg.dependencies ?? {}).filter(
    ([, version]) => !String(version).startsWith('workspace:'),
  ),
);

mkdirSync(out, { recursive: true });
cpSync(join(dir, 'dist'), join(out, 'dist'), { recursive: true });
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', dependencies }, null, 2)}\n`,
);
console.log(
  `${pkg.name} -> ${out}: ${Object.keys(dependencies).join(', ') || 'no runtime dependencies'}`,
);
