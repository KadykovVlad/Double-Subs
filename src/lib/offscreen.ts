/** Creates the offscreen document if it does not exist yet. Called by the background and the lab page. */
export async function ensureOffscreen(): Promise<void> {
  const existing = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await browser.offscreen.createDocument({
    url: 'offscreen.html',
    // None of Chrome's offscreen reasons covers translation (see PLAN.md, stage 4). DOM_PARSER is
    // genuine for the product: TTML/DFXP subtitles are XML, and service workers have no DOMParser.
    // TESTING is not an option: Chrome only allows it with a command-line switch.
    reasons: [browser.offscreen.Reason.DOM_PARSER],
    justification: 'Parses XML subtitle files (TTML/DFXP) and translates subtitle text on-device.',
  });
}
