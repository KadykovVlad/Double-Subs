// Checks the build that goes to the store (.output/chrome-mv3): the pieces the product needs are
// there, and the prototypes and test code are not. Run after `wxt build` (npm run check:store).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = '.output/chrome-mv3';
const problems = [];
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

for (const file of [
  'sidepanel.html',
  'agent.js',
  'auto-flag.js',
  'auto-probe.js',
  'background.js',
  'offscreen.html',
]) {
  if (!existsSync(join(dir, file))) problems.push(`missing ${file}`);
}
if (manifest.side_panel?.default_path !== 'sidepanel.html')
  problems.push('manifest has no side_panel');
if (!manifest.permissions?.includes('sidePanel'))
  problems.push('manifest lacks the sidePanel permission');
if (manifest.action?.default_popup) problems.push('a popup is still declared');
if (manifest.web_accessible_resources)
  problems.push('web_accessible_resources must not exist in the store build');
for (const file of ['translator-lab.html', 'translator-frame.html']) {
  if (existsSync(join(dir, file))) problems.push(`prototype page ${file} is in the store build`);
}
if (!manifest.minimum_chrome_version) problems.push('no minimum_chrome_version');

const walk = (path) =>
  statSync(path).isDirectory() ? readdirSync(path).flatMap((n) => walk(join(path, n))) : [path];
for (const file of walk(dir).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(file, 'utf8');
  for (const marker of ['e2eSpoken', 'data-layouts', 'layouts =', 'VITE_DS_E2E']) {
    if (text.includes(marker)) problems.push(`${file} contains test code (${marker})`);
  }
}

if (problems.length > 0) {
  console.error('Store build check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Store build check passed.');
