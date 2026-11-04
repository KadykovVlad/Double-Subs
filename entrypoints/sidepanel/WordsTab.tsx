import { useState } from 'preact/hooks';
import {
  filterWords,
  removeSavedWord,
  toggleFavorite,
  type SavedWord,
} from '../../src/lib/saved-words';
import { speakWord } from '../../src/lib/speech';
import { isDue, newSrs, wordStatus, type WordStatus } from '../../src/lib/srs';
import { buildSession } from '../../src/lib/review';
import { useCompletedWords, useSavedWords } from './hooks';
import { Context, Review } from './Review';
import { Button, Card, Empty, Icons, SearchField, SectionTitle } from './ui';
import { t, uiLanguage, type MessageKey } from '../../src/lib/i18n';

const STATUS_KEY: Record<WordStatus, MessageKey> = {
  new: 'status_new',
  review: 'status_review',
  learned: 'status_learned',
};

type Filter = 'all' | 'due' | 'fav';

export const dueWords = (words: SavedWord[], now = Date.now()) =>
  words.filter((word) => word.srs && isDue(word.srs, now)).sort((a, b) => a.srs!.due - b.srs!.due);

export function WordsTab() {
  const words = useSavedWords();
  useCompletedWords(words);
  const [queue, setQueue] = useState<SavedWord[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [status, setStatus] = useState<WordStatus | ''>('');
  const [query, setQuery] = useState('');
  const due = dueWords(words);
  const favorites = words.filter((word) => word.favorite);
  const dueKeys = new Set(due.map((word) => word.key));
  const shown = filterWords(
    filter === 'due'
      ? words.filter((w) => dueKeys.has(w.key))
      : filter === 'fav'
        ? favorites
        : words,
    query,
  ).filter((word) => !status || wordStatus(word.srs ?? newSrs(word.savedAt)) === status);
  const chips: Array<[Filter, MessageKey, number]> = [
    ['all', 'words_filter_all', words.length],
    ['due', 'words_filter_due', due.length],
    ['fav', 'words_filter_fav', favorites.length],
  ];

  if (queue) return <Review session={queue} pool={words} onClose={() => setQueue(null)} />;
  const session = buildSession(due);

  return (
    <>
      <Card>
        <div class="stat">
          <div>
            <b data-testid="due-count">{due.length}</b>
            <span class="muted">{t('words_due')}</span>
          </div>
          <div>
            <b>{words.length}</b>
            <span class="muted">{t('words_total')}</span>
          </div>
        </div>
        <Button
          testid="start-review"
          block
          disabled={due.length === 0}
          onClick={() => setQueue(session)}
        >
          {due.length > 0 ? t('review_start', session.length) : t('review_none')}
        </Button>
      </Card>

      <SectionTitle>
        <span data-testid="saved-count">{t('words_saved', words.length)}</span>
      </SectionTitle>
      {words.length === 0 ? (
        <Card>
          <Empty icon={Icons.words} title={t('words_empty_title')}>
            {t('words_empty_text')}
          </Empty>
        </Card>
      ) : (
        <>
          <div class="filter-chips" role="group">
            {chips.map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                class="filter-chip"
                aria-pressed={filter === id}
                data-testid={`words-filter-${id}`}
                onClick={() => setFilter(id)}
              >
                {t(label)}
                <span class="n">{count}</span>
              </button>
            ))}
          </div>
          <div class="toolbar">
            <SearchField
              placeholder={t('words_search')}
              value={query}
              testid="words-search"
              onInput={setQuery}
            />
            <select
              aria-label={t('words_status_all')}
              data-testid="words-status"
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value as WordStatus | '')}
            >
              <option value="">{t('words_status_all')}</option>
              {(Object.keys(STATUS_KEY) as WordStatus[]).map((id) => (
                <option key={id} value={id}>
                  {t(STATUS_KEY[id])}
                </option>
              ))}
            </select>
          </div>
          <Card>
            {shown.length === 0 ? (
              <Empty icon={Icons.search} title={t('nothing_found')} />
            ) : (
              <ul class="list" data-testid="saved-words">
                {shown.map((item) => (
                  <WordRow key={item.key} item={item} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function WordRow({ item }: { item: SavedWord }) {
  const status = wordStatus(item.srs ?? newSrs(item.savedAt));
  const date = new Date(item.savedAt).toLocaleDateString(uiLanguage(), {
    day: 'numeric',
    month: 'short',
  });
  return (
    <li class="word-item" data-testid="saved-word">
      <span class="grow word-main">
        <span class="word-head">
          <b>{item.word}</b>
          {item.form && <span class="muted"> ({item.form})</span>}
          <button
            class="icon-btn sm"
            type="button"
            title={t('listen')}
            aria-label={t('listen')}
            onClick={() => speakWord(item.word, item.lang)}
          >
            {Icons.volume}
          </button>
        </span>
        {/* The dash is for copied text and screen readers; on screen the translation is its own line. */}
        <span class="sep">{' — '}</span>
        <span class="word-tr">{item.translation ?? '…'}</span>
        {item.definition && (
          <div class="word-def" data-testid="word-definition">
            {item.definition}
          </div>
        )}
        <div class="word-ctx">
          <Context word={item} />
        </div>
      </span>
      <span class="word-side">
        <span class="word-actions">
          {item.favorite ? (
            <span class="tag fav">{t('words_filter_fav')}</span>
          ) : (
            <span class={`tag ${status}`} data-testid="word-status">
              {t(STATUS_KEY[status])}
            </span>
          )}
          <button
            class={`icon-btn star${item.favorite ? ' on' : ''}`}
            type="button"
            aria-pressed={!!item.favorite}
            title={t(item.favorite ? 'favorite_remove' : 'favorite_add')}
            aria-label={t(item.favorite ? 'favorite_remove' : 'favorite_add')}
            data-testid="word-favorite"
            onClick={() => void toggleFavorite(item.key)}
          >
            {Icons.star}
          </button>
          <button
            class="icon-btn"
            type="button"
            title={t('remove')}
            aria-label={t('remove_item', item.word)}
            onClick={() => void removeSavedWord(item.key)}
          >
            {Icons.trash}
          </button>
        </span>
        <small class="muted">{date}</small>
      </span>
    </li>
  );
}
