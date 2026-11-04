import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from '../../src/lib/i18n';
import {
  checkTyped,
  clozeOf,
  exerciseFor,
  retryLater,
  shuffle,
  wrongChoices,
  type Typed,
} from '../../src/lib/review';
import { updateSavedSrs, type SavedWord } from '../../src/lib/saved-words';
import { loadSettings } from '../../src/lib/settings';
import { speakWord } from '../../src/lib/speech';
import { gapLabel, grade } from '../../src/lib/srs';
import { Button, Card, Empty, Icons, Progress } from './ui';

type Answer = (remembered: boolean) => void;

/** The word in its sentence, with the word itself marked. */
export function Context({ word }: { word: SavedWord }) {
  const heard = word.form ?? word.word;
  const at = word.context.toLowerCase().indexOf(heard.toLowerCase());
  if (at < 0) return <>{word.context}</>;
  return (
    <>
      {word.context.slice(0, at)}
      <mark>{word.context.slice(at, at + heard.length)}</mark>
      {word.context.slice(at + heard.length)}
    </>
  );
}

/** Hearing a word ties its sound to its meaning: said as the card asks for it, if the user wants words said. */
function useSaid(word: SavedWord, when: boolean) {
  useEffect(() => {
    if (!when) return;
    void loadSettings().then((settings) => {
      if (settings.speakWords) speakWord(word.word, word.lang);
    });
  }, [when]);
}

function Listen({ word }: { word: SavedWord }) {
  return (
    <button
      class="icon-btn"
      type="button"
      aria-label={t('listen')}
      onClick={() => speakWord(word.word, word.lang)}
      style={{ margin: '4px auto 0' }}
    >
      {Icons.volume}
    </button>
  );
}

function Meaning({ word }: { word: SavedWord }) {
  return (
    <p class="review-answer" data-testid="review-answer">
      {word.translation ?? t('review_no_translation')}
      {word.definition && <small class="word-def">{word.definition}</small>}
    </p>
  );
}

/** The first meeting: the word in its sentence, and its meaning to recognise among others. */
function Choose({ word, pool, answer }: { word: SavedWord; pool: SavedWord[]; answer: Answer }) {
  const options = useMemo(
    () => shuffle([word.translation!, ...wrongChoices(word, pool)]),
    [word.key],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const done = picked !== null || gaveUp;
  useSaid(word, true);
  return (
    <>
      <Card class="review-card">
        <p class="review-prompt">{t('review_choose')}</p>
        <div class="review-word" data-testid="review-word">
          {word.word}
        </div>
        <Listen word={word} />
        <p class="review-ctx">
          <Context word={word} />
        </p>
        {done && word.definition && <small class="word-def">{word.definition}</small>}
      </Card>
      <div class="review-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={done}
            class={`review-option${done && option === word.translation ? ' right' : ''}${
              option === picked && option !== word.translation ? ' wrong' : ''
            }`}
            data-testid="review-option"
            onClick={() => setPicked(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {done ? (
        <Button testid="review-next" block onClick={() => answer(picked === word.translation)}>
          {t('review_next')}
        </Button>
      ) : (
        <Button variant="ghost" testid="rate-again" block onClick={() => setGaveUp(true)}>
          {t('rating_again')}
        </Button>
      )}
    </>
  );
}

/** Recall from nothing: the sentence would give the word away, so it comes with the answer. */
function Recall({ word, answer }: { word: SavedWord; answer: Answer }) {
  const [shown, setShown] = useState(false);
  useSaid(word, true);
  const now = Date.now();
  return (
    <>
      <Card class="review-card">
        <p class="review-prompt">{t('review_recall')}</p>
        <div class="review-word" data-testid="review-word">
          {word.word}
        </div>
        <Listen word={word} />
        {shown && (
          <>
            <Meaning word={word} />
            <p class="review-ctx">
              <Context word={word} />
            </p>
          </>
        )}
      </Card>
      {!shown ? (
        <Button testid="review-show" block onClick={() => setShown(true)}>
          {t('review_show')}
        </Button>
      ) : (
        <div class="rate">
          <button
            type="button"
            class="again"
            data-testid="rate-again"
            onClick={() => answer(false)}
          >
            {t('rating_again')}
            <small>{gapLabel(word.srs!, false, now)}</small>
          </button>
          <button type="button" class="good" data-testid="rate-good" onClick={() => answer(true)}>
            {t('review_remembered')}
            <small>{gapLabel(word.srs!, true, now)}</small>
          </button>
        </div>
      )}
    </>
  );
}

/** Producing the word: its meaning and the film's sentence with a gap, and the first letter to start from. */
function Type({ word, answer }: { word: SavedWord; answer: Answer }) {
  const cloze = clozeOf(word)!;
  const [input, setInput] = useState('');
  const [result, setResult] = useState<Typed | null>(null);
  useSaid(word, result !== null);
  return (
    <>
      <Card class="review-card">
        <p class="review-prompt">{t('review_type')}</p>
        <p class="review-answer" data-testid="review-translation">
          {word.translation}
        </p>
        <p class="review-cloze" data-testid="review-cloze">
          {cloze.before}
          <b>{result ? cloze.heard : `${cloze.heard[0]}…`}</b>
          {cloze.after}
        </p>
        {result && (
          <p
            class={`review-feedback ${result === 'wrong' ? 'wrong' : 'right'}`}
            data-testid="review-feedback"
          >
            {result === 'right'
              ? t('review_right')
              : t(result === 'almost' ? 'review_almost' : 'review_wrong', cloze.heard)}
          </p>
        )}
        {result && <Listen word={word} />}
      </Card>
      {result ? (
        <Button testid="review-next" block onClick={() => answer(result !== 'wrong')}>
          {t('review_next')}
        </Button>
      ) : (
        <form
          class="review-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim()) setResult(checkTyped(input, word));
          }}
        >
          <input
            class="field"
            autoFocus
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-label={t('review_type')}
            data-testid="review-input"
            value={input}
            onInput={(event) => setInput(event.currentTarget.value)}
          />
          <button class="btn block" type="submit" data-testid="review-check">
            {t('review_check')}
          </button>
          <Button variant="ghost" testid="rate-again" block onClick={() => setResult('wrong')}>
            {t('rating_again')}
          </Button>
        </form>
      )}
    </>
  );
}

/**
 * One card at a time, each as hard as the word is ready for. A forgotten word comes back in this same
 * session until it is remembered once: an answer that ends on a failure teaches the failure.
 */
export function Review({
  session,
  pool,
  onClose,
}: {
  session: SavedWord[];
  pool: SavedWord[];
  onClose: () => void;
}) {
  const [queue, setQueue] = useState(session);
  const [index, setIndex] = useState(0);
  const word = queue[index];

  if (!word) {
    return (
      <Card class="review-card">
        <Empty icon={Icons.check} title={t('review_done_title')}>
          {t('review_done_text', session.length)}
        </Empty>
        <Button testid="review-close" block onClick={onClose}>
          {t('review_to_list')}
        </Button>
      </Card>
    );
  }

  const answer: Answer = (remembered) => {
    const srs = grade(word.srs!, remembered, Date.now(), Math.random() * 2 - 1);
    void updateSavedSrs(word.key, srs);
    if (!remembered) setQueue(retryLater(queue, index, { ...word, srs }));
    setIndex(index + 1);
  };

  const exercise = exerciseFor(word, pool);
  // A new key: the next card, even of the same word, starts clean.
  const key = `${index}-${word.key}`;
  return (
    <>
      <div class="row">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('back')}
        </Button>
        <span class="grow" />
        <span class="muted" data-testid="review-progress">
          {t('review_progress', index + 1, queue.length)}
        </span>
      </div>
      <Progress value={index / queue.length} />
      {exercise === 'choose' && <Choose key={key} word={word} pool={pool} answer={answer} />}
      {exercise === 'recall' && <Recall key={key} word={word} answer={answer} />}
      {exercise === 'type' && <Type key={key} word={word} answer={answer} />}
    </>
  );
}
