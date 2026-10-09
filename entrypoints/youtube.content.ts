import { YouTubeSource } from '../src/youtube/YouTubeSource';

const YOUTUBE = ['*://*.youtube.com/*'];
// The e2e build also runs on the local fake YouTube page.
const E2E = ['http://localhost/*'];

/**
 * Permanent script for YouTube (isolated world). Receives what the MAIN-world script captures and
 * gives the agent a bridge to YouTube's subtitles, which are not <track> elements.
 */
export default defineContentScript({
  matches: import.meta.env.VITE_DS_E2E ? [...YOUTUBE, ...E2E] : YOUTUBE,
  runAt: 'document_start',
  main() {
    window.__doubleSubYouTube = new YouTubeSource().start();
  },
});
