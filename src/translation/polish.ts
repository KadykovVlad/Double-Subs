/**
 * Fixes small, predictable flaws of machine translation. The built-in translator often starts a
 * reply with a lower-case letter ("ты меня услышал."), which looks wrong as a subtitle.
 */
export function polishTranslation(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/\s+/g, ' ').trim();
      // Keep a leading dash of dialogue ("- hello") and capitalise the first letter after it.
      return trimmed.replace(
        /^([-–—\s"«(]*)(\p{Ll})/u,
        (_, lead: string, letter: string) => lead + letter.toUpperCase(),
      );
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Cue text sent to the translator: one line, because it translates a string, not a block. */
export function toTranslatorText(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}
