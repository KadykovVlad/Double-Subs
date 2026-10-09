import { Agent } from '../src/agent/Agent';

declare global {
  interface Window {
    __doubleSubAgent?: boolean;
  }
}

/**
 * Injected into the frames of the page: by the side panel on a click, or by the background on a
 * site the user already has. The work is in src/agent/. A second injection does nothing: the first
 * agent keeps its state.
 */
export default defineUnlistedScript(() => {
  if (window.__doubleSubAgent) return;
  window.__doubleSubAgent = true;
  new Agent().start();
});
