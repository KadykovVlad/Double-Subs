import { posName, type WordInfo } from '../lib/dictionary';
import { markWord, matchesTranslation, splitWords, wordKey, type WordLang } from '../lib/words';
import { t, textDirection } from '../lib/i18n';

export type WordTranslation =
  { ok: true; text: string } | { ok: false; reason: 'needs-model' | 'unavailable' | 'failed' };

export interface SaveRequest {
  word: string;
  lang: WordLang;
  translation: string | null;
  /** The whole subtitle line the word is in. */
  context: string;
  /** The dictionary's answer for the word, when there was one. */
  info: WordInfo | null;
}

/** What the overlay needs from outside to make words interactive. */
export interface WordTools {
  translate(word: string, lang: WordLang): Promise<WordTranslation>;
  /** The word translated inside its sentence (the word is marked with «»); ok: false when that did not work. */
  translateInContext(
    word: string,
    lang: WordLang,
    markedSentence: string,
  ): Promise<WordTranslation>;
  /** The dictionary form and meaning of the word; null when the dictionary does not know it. */
  lookup(word: string, lang: WordLang): Promise<WordInfo | null>;
  /** Says the word aloud. */
  speak(word: string, lang: WordLang): void;
  /** Saves the word, or removes it when it is already saved. */
  toggleSaved(request: SaveRequest): void;
}

export const WORDS_STYLE = `
  .w { pointer-events: auto; cursor: pointer; border-radius: 0.2em; transition: background 0.12s; }
  .w:hover { background: rgba(255, 255, 255, 0.22); }
  .w.saved { text-decoration: underline dotted #ffd166; text-underline-offset: 0.2em; text-decoration-thickness: 2px; }
  .w.match { background: rgba(255, 214, 120, 0.3); }
  .tip {
    position: fixed; pointer-events: none; max-width: 280px; padding: 9px 13px; border-radius: 14px;
    background: rgb(var(--tint-rgb, 72 72 80) / var(--panel-alpha, 0.72)); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2);
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(1.25); backdrop-filter: blur(var(--blur, 26px)) saturate(1.25);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
    font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif; text-align: left;
  }
  .tip[hidden] { display: none; }
  .tip-word { color: rgba(255, 255, 255, 0.6); font-size: 12px; }
  .tip-word .ipa { margin-left: 6px; opacity: 0.8; }
  .tip-lemma { margin-top: 2px; font-size: 13px; color: rgba(255, 255, 255, 0.85); }
  .tip-lemma b { font-weight: 700; }
  .tip-dict { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(255, 255, 255, 0.14); font-size: 12px; line-height: 1.35; color: rgba(255, 255, 255, 0.78); }
  .tip-dict i { font-style: normal; color: rgba(255, 255, 255, 0.5); margin-right: 4px; }
  .tip-row { margin-top: 3px; }
  .tip-label { color: rgba(255, 255, 255, 0.5); font-size: 11px; letter-spacing: 0.02em; }
  .tip-text, .tip-ctx-text { font-size: 17px; font-weight: 600; }
  .tip-text.pending, .tip-ctx-text.pending { opacity: 0.5; }
  .tip-row .tip-text:not(:only-child), .tip-row .tip-ctx-text:not(:only-child) { margin-top: 0; }
  .tip-hint { margin-top: 2px; color: rgba(255, 255, 255, 0.5); font-size: 11px; }
`;

/** The pointer must stay on a word this long before anything happens: crossing a line is not hovering. */
export const HOVER_DELAY_MS = 150;
/** After the pointer leaves the words the video stays paused for a moment: moving to the next word is fine. */
export const RESUME_GRACE_MS = 250;

const FAILURE_KEY = {
  'needs-model': 'tip_needs_model',
  unavailable: 'tip_unavailable',
  failed: 'tip_failed',
} as const;

/** What the tip shows for a word: its meaning in this sentence and its plain dictionary meaning. */
interface TipContent {
  context: string | null;
  plain: string | null;
  /** Still waiting for the context translation. */
  pending: boolean;
  failure: string | null;
  info: WordInfo | null;
}

const div = (className: string, textContent: string) =>
  Object.assign(document.createElement('div'), { className, textContent });

/** The small window next to the hovered word with its translation. It only draws what it is given. */
class WordTip {
  private readonly el = Object.assign(document.createElement('div'), {
    className: 'tip',
    hidden: true,
    dir: textDirection(),
  });
  /** What is shown now, so the tip can be redrawn when the word is saved or removed. */
  content: TipContent | null = null;

  constructor(root: ShadowRoot) {
    root.append(this.el);
  }

  show(word: HTMLElement, content: TipContent, isSaved: boolean): void {
    this.content = content;
    const head = div('tip-word', word.dataset.word ?? '');
    if (content.info?.ipa)
      head.append(
        Object.assign(document.createElement('span'), {
          className: 'ipa',
          textContent: content.info.ipa,
        }),
      );
    this.el.replaceChildren(head);
    if (content.info?.inflected) {
      const lemma = div('tip-lemma', '→ ');
      lemma.append(Object.assign(document.createElement('b'), { textContent: content.info.lemma }));
      this.el.append(lemma);
    }
    const same =
      content.context &&
      content.plain &&
      content.context.toLowerCase() === content.plain.toLowerCase();
    if (content.failure) {
      this.el.append(div('tip-text', content.failure));
    } else if (same) {
      this.el.append(this.row(t('tip_translation'), content.plain!, 'tip-text'));
    } else {
      if (content.context)
        this.el.append(this.row(t('tip_context'), content.context, 'tip-ctx-text'));
      else if (content.pending && content.plain)
        this.el.append(this.row(t('tip_context'), '…', 'tip-ctx-text pending'));
      this.el.append(this.row(t('tip_meaning'), content.plain ?? '…', 'tip-text'));
    }
    for (const sense of content.info?.senses.slice(0, 2) ?? []) {
      const line = div('tip-dict', sense.meanings[0] ?? '');
      line.prepend(Object.assign(document.createElement('i'), { textContent: posName(sense.pos) }));
      this.el.append(line);
    }
    this.el.append(div('tip-hint', t(isSaved ? 'tip_saved' : 'tip_save')));
    this.el.hidden = false;
    this.place(word);
  }

  hide(): void {
    this.el.hidden = true;
    this.el.replaceChildren(); // no stale text for the next word
    this.content = null;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  destroy(): void {
    this.el.remove();
  }

  private row(label: string, text: string, textClass: string): HTMLElement {
    const el = div('tip-row', '');
    el.append(div('tip-label', label), div(textClass, text));
    return el;
  }

  /** Subtitles sit low on the screen, so the tip goes above the word unless there is no room. */
  private place(word: HTMLElement): void {
    const rect = word.getBoundingClientRect();
    const tip = this.el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - tip.width / 2),
      window.innerWidth - tip.width - margin,
    );
    const above = rect.top - tip.height - margin;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${above >= margin ? above : rect.bottom + margin}px`;
  }
}

/**
 * Makes the words of the subtitle lines alive: hovering one (for a moment) shows its translation,
 * says it aloud and pauses the video, a click saves it. Lines are drawn by `renderLine`.
 */
export class WordsUi {
  private readonly tip: WordTip;
  private saved = new Set<string>();
  private active: HTMLElement | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private pausedByUs = false;
  private request = 0;
  /** Translations of the words seen in this overlay, to save them without asking again. */
  private readonly translations = new Map<string, string>();
  /** Dictionary answers for the words seen, to save them and to tell saved ones apart. */
  private readonly infos = new Map<string, WordInfo>();

  constructor(
    private readonly root: ShadowRoot,
    private readonly video: HTMLVideoElement,
    private readonly tools: WordTools,
    private readonly getSettings: () => { pauseOnHover: boolean; speakWords: boolean },
  ) {
    this.tip = new WordTip(root);
    video.addEventListener('play', this.onVideoPlay);
    root.addEventListener('mouseover', this.onOver);
    root.addEventListener('mouseout', this.onOut);
    root.addEventListener('click', this.onClick);
    root.addEventListener('mousedown', this.swallow);
    root.addEventListener('dblclick', this.swallow);
  }

  /** Fills `el` with the line: a span per word so that each can be hovered. */
  renderLine(el: HTMLElement, text: string, lang: WordLang): void {
    const nodes: Node[] = splitWords(text, lang).map((part) => {
      if (!part.word) return document.createTextNode(part.text);
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = part.text;
      span.dataset.word = part.text;
      span.dataset.lang = lang;
      span.dataset.key = wordKey(part.text, lang);
      this.markSaved(span);
      return span;
    });
    el.replaceChildren(...nodes);
  }

  /** Keys (wordKey) of the saved words, which get underlined. */
  setSaved(keys: Set<string>): void {
    this.saved = keys;
    this.root.querySelectorAll<HTMLElement>('.w').forEach((el) => this.markSaved(el));
    // The tip of the hovered word says whether it is saved.
    if (this.active && this.tip.visible && this.tip.content)
      this.tip.show(this.active, this.tip.content, this.isSaved(this.active));
  }

  destroy(): void {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.resumeTimer);
    this.video.removeEventListener('play', this.onVideoPlay);
    this.root.removeEventListener('mouseover', this.onOver);
    this.root.removeEventListener('mouseout', this.onOut);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('mousedown', this.swallow);
    this.root.removeEventListener('dblclick', this.swallow);
    this.resumeIfPaused();
    this.tip.destroy();
  }

  // ---------------------------------------------------------------- saved words

  /** Saved by its own form, or as the dictionary word it belongs to ("went" when "go" is saved). */
  private isSaved = (word: HTMLElement) => {
    if (this.saved.has(word.dataset.key!)) return true;
    const info = this.infos.get(word.dataset.key!);
    return info ? this.saved.has(wordKey(info.lemma, 'en')) : false;
  };
  private markSaved(el: HTMLElement): void {
    el.classList.toggle('saved', this.isSaved(el));
  }

  // ---------------------------------------------------------------- pause while hovering

  private pauseIfNeeded(): void {
    if (this.getSettings().pauseOnHover && !this.video.paused) {
      this.video.pause();
      this.pausedByUs = true;
    }
  }

  private resumeIfPaused(): void {
    if (!this.pausedByUs) return;
    this.pausedByUs = false;
    void this.video.play().catch(() => {});
  }

  /** The user pressed play themselves while hovering: do not pause or resume against their will. */
  private readonly onVideoPlay = () => {
    this.pausedByUs = false;
  };

  // ---------------------------------------------------------------- hovering

  private enter(word: HTMLElement): void {
    clearTimeout(this.resumeTimer);
    clearTimeout(this.hoverTimer);
    if (word === this.active) return;
    this.hoverTimer = setTimeout(() => void this.showFor(word), HOVER_DELAY_MS);
  }

  private leave(): void {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.request++;
      this.hideTip();
      this.resumeIfPaused();
    }, RESUME_GRACE_MS);
  }

  private hideTip(): void {
    this.tip.hide();
    this.active = null;
    this.clearMatches();
  }

  /** The pointer has rested on the word: pause, say it, ask for its two meanings and show them as they come. */
  private async showFor(word: HTMLElement): Promise<void> {
    this.active = word;
    const id = ++this.request;
    this.pauseIfNeeded();
    const content: TipContent = {
      context: null,
      plain: null,
      pending: true,
      failure: null,
      info: null,
    };
    this.tip.show(word, content, this.isSaved(word));

    const lang = word.dataset.lang as WordLang;
    const text = word.dataset.word!;
    if (this.getSettings().speakWords) this.tools.speak(text, lang);

    const refresh = () => {
      if (id !== this.request || this.active !== word) return; // the pointer has moved on
      this.tip.show(word, content, this.isSaved(word));
      this.remember(word, content);
      this.highlightInOtherLine(word, [content.context, content.plain]);
    };
    const plain = this.tools.translate(text, lang).then((result) => {
      if (result.ok) content.plain = result.text;
      else content.failure = t(FAILURE_KEY[result.reason]);
      refresh();
    });
    const context = this.tools
      .translateInContext(text, lang, this.markedSentence(word))
      .then((result) => {
        if (result.ok) content.context = result.text;
        content.pending = false;
        refresh();
      });
    const dictionary = this.tools.lookup(text, lang).then((info) => {
      if (!info) return;
      content.info = info;
      if (this.infos.size > 300) this.infos.clear();
      this.infos.set(word.dataset.key!, info);
      this.markSaved(word);
      refresh();
    });
    await Promise.all([plain, context, dictionary]);
  }

  /** Saved with both meanings: the one in this sentence first, then the dictionary one. */
  private remember(word: HTMLElement, content: TipContent): void {
    const both =
      content.context &&
      content.plain &&
      content.context.toLowerCase() !== content.plain.toLowerCase();
    const best = both
      ? `${content.context} · ${content.plain}`
      : (content.plain ?? content.context);
    if (!best) return;
    if (this.translations.size > 300) this.translations.clear();
    this.translations.set(word.dataset.key!, best);
  }

  /** The line of the word with the word itself marked: the translator sees it in its sentence. */
  private markedSentence(word: HTMLElement): string {
    const line = word.closest('.line');
    if (!line) return markWord(word.dataset.word!);
    return Array.from(line.childNodes)
      .map((node) => (node === word ? markWord(word.textContent ?? '') : (node.textContent ?? '')))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private clearMatches(): void {
    this.root.querySelectorAll('.w.match').forEach((el) => el.classList.remove('match'));
  }

  private highlightInOtherLine(word: HTMLElement, candidates: Array<string | null>): void {
    this.clearMatches();
    const ownLine = word.closest('.line');
    const wanted = candidates.filter((t): t is string => Boolean(t));
    this.root.querySelectorAll<HTMLElement>('.w').forEach((candidate) => {
      if (
        candidate.closest('.line') !== ownLine &&
        wanted.some((t) => matchesTranslation(t, candidate.textContent ?? ''))
      ) {
        candidate.classList.add('match');
      }
    });
  }

  // ---------------------------------------------------------------- pointer events

  private wordAt(event: Event): HTMLElement | null {
    return (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.w') ?? null;
  }

  private readonly onOver = (event: Event) => {
    const word = this.wordAt(event);
    if (word) this.enter(word);
  };

  private readonly onOut = (event: Event) => {
    if (!this.wordAt(event)) return;
    const to = (event as MouseEvent).relatedTarget as HTMLElement | null;
    if (to?.closest?.('.w')) return; // moving to another word: its mouseover takes over
    this.leave();
  };

  private readonly onClick = (event: Event) => {
    const word = this.wordAt(event);
    if (!word) return;
    // The click must not reach the player: in fullscreen the overlay sits inside its container.
    event.preventDefault();
    event.stopPropagation();
    this.tools.toggleSaved({
      word: word.dataset.word!,
      lang: word.dataset.lang as WordLang,
      translation: this.translations.get(word.dataset.key!) ?? null,
      context: word.closest('.line')?.textContent ?? '',
      info: this.infos.get(word.dataset.key!) ?? null,
    });
  };

  private readonly swallow = (event: Event) => {
    if (this.wordAt(event)) event.stopPropagation();
  };
}
