import { AUTO_EVENT } from '../src/lib/auto-event';

declare global {
  interface Window {
    /** Set by the automatic start of the agent, absent when the side panel injects it. */
    __doubleSubAuto?: boolean;
  }
}

/** Runs before the agent when it is started on a known site. */
export default defineUnlistedScript(() => {
  window.__doubleSubAuto = true;
  window.dispatchEvent(new Event(AUTO_EVENT));
});
