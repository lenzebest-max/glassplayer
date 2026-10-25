// Syntax-checks every source file without needing Electron.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);

let failed = 0;
for (const file of [...walk(path.join(root, 'main')), ...walk(path.join(root, 'renderer'))]) {
  const isModule = file.includes(`${path.sep}renderer${path.sep}`);
  try {
    execFileSync(process.execPath, isModule ? ['--input-type=module', '--check'] : ['--check', file], {
      input: isModule ? fs.readFileSync(file) : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(root, file)}\n${err.stderr}`);
  }
}
console.log(failed ? `${failed} file(s) failed` : 'All files OK');
process.exit(failed ? 1 : 0);
