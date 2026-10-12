/**
 * Timing of YouTube's subtitles, step by step (debugging aid): the page load or the switch to the
 * video, the first /api/timedtext request, its first answer with text, the lines handed over to the
 * overlay. `t` is performance.now(), the same clock in the page world and in ours. Dev and test
 * builds only: the store build stays quiet.
 */
export function logTiming(step: string, data: Record<string, unknown>): void {
  if (__DS_PROTOTYPES__)
    console.info(
      '[Double Sub] YouTube timing',
      JSON.stringify({ step, t: Math.round(performance.now()), ...data }),
    );
}
