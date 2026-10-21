// Builds the extension and puts the result in extension/, a folder that is committed in the working
// branches: pull the branch, load extension/ in chrome://extensions ("Load unpacked"), press reload
// after the next pull. No Node needed on the machine that tests. The folder is removed before a
// merge into main (git rm -r extension), see HANDOFF.md.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';

const built = '.output/chrome-mv3';
const target = 'extension';

execFileSync('npx', ['wxt', 'build'], { stdio: 'inherit' });
if (!existsSync(`${built}/manifest.json`)) {
  console.error(`No ${built}/manifest.json after the build.`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true });
console.log(`Copied ${built} → ${target}/`);
