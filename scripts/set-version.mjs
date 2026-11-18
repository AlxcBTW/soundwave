// Sets the app's version everywhere it is written down: package.json (which the desktop app reads
// through src-tauri/tauri.conf.json) and src-tauri/Cargo.toml. Used by the release workflows.
//
//   node scripts/set-version.mjs 1.2.3
//   node scripts/set-version.mjs 1.2.4-57
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
// Windows installers (MSI) only take a number after the dash, so pre-releases are 1.2.4-57, not 1.2.4-pre.57.
if (!/^\d+\.\d+\.\d+(-\d+)?$/.test(version ?? '')) {
  console.error(`Not a version this project uses: "${version ?? ''}" (expected 1.2.3 or 1.2.3-45)`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const updated = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
if (updated === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error('src-tauri/Cargo.toml has no version line to update');
  process.exit(1);
}
writeFileSync(cargoPath, updated);
console.log(`version ${version}`);
