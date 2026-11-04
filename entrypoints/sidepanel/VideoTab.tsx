import { useState } from 'preact/hooks';
import { displayUrl } from '../../src/lib/history';
import { t, type MessageKey } from '../../src/lib/i18n';
import { webOrigin } from '../../src/lib/known-sites';
import {
  addToWatchlist,
  MAX_WATCHLIST,
  removeFromWatchlist,
  type AddResult,
  type WatchItem,
} from '../../src/lib/watchlist';
import { showToast } from '../../src/panel/toasts';
import { useWatchlist } from './hooks';
import { HistoryTab } from './HistoryTab';
import { Button, Card, Empty, Icons, VideoThumb } from './ui';

type View = 'saved' | 'history';

const VIEWS: Array<{ id: View; label: MessageKey }> = [
  { id: 'saved', label: 'saved_tab' },
  { id: 'history', label: 'tab_history' },
];

/** What the user put aside and what was watched. A free account starts on the history, which it has. */
export function VideoTab({
  tabId,
  pageUrl,
  allowed,
}: {
  tabId: number | null;
  pageUrl: string | null;
  /** From the panel, which has read the plan already: read here, the free view would flash first. */
  allowed: boolean;
}) {
  const [chosen, setChosen] = useState<View | null>(null);
  const view = chosen ?? (allowed ? 'saved' : 'history');

  return (
    <>
      <div class="subtabs" role="tablist">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            class="subtab"
            type="button"
            role="tab"
            aria-selected={view === item.id}
            data-testid={`video-${item.id}`}
            onClick={() => setChosen(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {view === 'saved' ? (
        <SavedView tabId={tabId} pageUrl={pageUrl} allowed={allowed} />
      ) : (
        <HistoryTab />
      )}
    </>
  );
}

function noticeOf(result: AddResult): string | null {
  if (result === 'exists') return t('saved_exists');
  if (result === 'bad-url') return t('saved_bad_url');
  if (result === 'full') return t('saved_full', MAX_WATCHLIST);
  return null;
}

function SavedView({
  tabId,
  pageUrl,
  allowed,
}: {
  tabId: number | null;
  pageUrl: string | null;
  allowed: boolean;
}) {
  const list = useWatchlist();
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');

  const add = async (page: { url: string; title: string }): Promise<boolean> => {
    if (!allowed) {
      showToast({ tone: 'pro', title: t('toast_pro_title'), text: t('saved_tab') });
      return false;
    }
    const result = await addToWatchlist(page);
    setNotice(noticeOf(result));
    return result === 'added';
  };

  const addPage = async () => {
    const tab = tabId === null ? null : await browser.tabs.get(tabId).catch(() => null);
    await add({ url: tab?.url ?? pageUrl ?? '', title: tab?.title ?? '' });
  };

  return (
    <>
      <Card>
        {webOrigin(pageUrl) && (
          <Button block testid="saved-add-page" onClick={() => void addPage()}>
            {t('saved_add_page')}
          </Button>
        )}
        <details class="add-method" data-testid="saved-add-link">
          <summary>{t('saved_add_link')}</summary>
          <form
            class="saved-form"
            onSubmit={(event) => {
              event.preventDefault();
              void add({ url: link, title }).then((added) => {
                if (!added) return;
                setLink('');
                setTitle('');
              });
            }}
          >
            <input
              class="field"
              placeholder={t('saved_url')}
              aria-label={t('saved_url')}
              data-testid="saved-url"
              value={link}
              onInput={(event) => setLink(event.currentTarget.value)}
            />
            <input
              class="field"
              placeholder={t('saved_title')}
              aria-label={t('saved_title')}
              data-testid="saved-title"
              value={title}
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
            <button class="btn secondary" type="submit" data-testid="saved-submit">
              {t('saved_add')}
            </button>
          </form>
        </details>
        {notice && (
          <p class="small muted" role="status" data-testid="saved-notice">
            {notice}
          </p>
        )}
      </Card>
      {list.length === 0 ? (
        <Card>
          <Empty icon={Icons.history} title={t('saved_empty_title')}>
            {t('saved_empty_text')}
          </Empty>
        </Card>
      ) : (
        <ul class="list history-list" data-testid="saved-list">
          {list.map((item) => (
            <SavedRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}

function SavedRow({ item }: { item: WatchItem }) {
  return (
    <li class="history-item" data-testid="saved-item">
      <VideoThumb url={item.url} host={item.host} />
      <span class="grow">
        <div class="title" title={item.title}>
          {item.title}
        </div>
        <a class="page-url" href={item.url} target="_blank" rel="noreferrer" title={item.url}>
          {displayUrl(item.url)}
        </a>
      </span>
      <button
        class="play-btn"
        type="button"
        title={t('history_resume')}
        aria-label={t('history_resume_item', item.title)}
        data-testid="saved-open"
        onClick={() => void browser.tabs.create({ url: item.url })}
      >
        {Icons.play}
      </button>
      <button
        class="icon-btn"
        type="button"
        title={t('remove')}
        aria-label={t('remove_item', item.title)}
        data-testid="saved-remove"
        onClick={() => void removeFromWatchlist(item.id)}
      >
        {Icons.trash}
      </button>
    </li>
  );
}
