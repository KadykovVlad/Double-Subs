/**
 * Fixture pages for checking the extension by hand in your own Chrome (production build).
 * The page is on localhost, the player iframe on 127.0.0.1: a different origin the extension
 * has no permission for, exactly like a real site with an embedded player.
 *
 *   npm run fixtures   →   http://localhost:4100
 */
import { startFixtureServer } from './server.ts';

const player = await startFixtureServer('127.0.0.1', {}, 4200);
const vars = { IFRAME_ORIGIN: player.origin, FOREIGN_ORIGIN: player.origin };
const page = await startFixtureServer('localhost', vars, 4100);

console.log(`Тестовые страницы: ${page.origin}`);
console.log(`Плеер (другой origin): ${player.origin}`);
console.log('Остановить: Ctrl+C');
