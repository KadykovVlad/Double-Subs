import { useState } from 'preact/hooks';
import {
  clearHistory,
  displayUrl,
  filterHistory,
  formatDuration,
  groupByDay,
  historyHosts,
  removeHistoryEntry,
  resumeUrl,
  youtubeVideoId,
  type HistoryEntry,
} from '../../src/lib/history';
import { useHistory, useSettings } from './hooks';
import { Button, Card, Empty, Icons, Progress, SearchField } from './ui';
import { t, uiLanguage } from '../../src/lib/i18n';

export function HistoryTab() {
  const list = useHistory();
  const [settings] = useSettings();
  const [query, setQuery] = useState('');
  const [host, setHost] = useState('');

  if (list.length === 0) {
    return (
      <Card>
        <Empty icon={Icons.history} title={t('history_empty_title')}>
          {t(settings.keepHistory ? 'history_empty_on' : 'history_empty_off')}
        </Empty>
      </Card>
    );
  }

  const hosts = historyHosts(list);
  // A site that left the history (cleared, removed) is no longer a filter.
  const site = hosts.includes(host) ? host : '';
  const groups = groupByDay(filterHistory(list, query, site));

  return (
    <>
      <div class="toolbar">
        <SearchField
          placeholder={t('history_search')}
          value={query}
          testid="history-search"
          onInput={setQuery}
        />
        <select
          aria-label={t('history_all_sites')}
          data-testid="history-site"
          value={site}
          onChange={(event) => setHost(event.currentTarget.value)}
        >
          <option value="">{t('history_all_sites')}</option>
          {hosts.map((item) => (
            <option key={item} value={item}>
              {item.replace(/^www\./, '')}
            </option>
          ))}
        </select>
      </div>
      {groups.length === 0 ? (
        <Card>
          <Empty icon={Icons.search} title={t('nothing_found')} />
        </Card>
      ) : (
        <div class="history-groups" data-testid="history-list">
          {groups.map((group) => (
            <section key={group.day}>
              <h3 class="day-title" data-testid="history-day">
                {dayTitle(group.daysAgo, group.day)}
              </h3>
              <ul class="list history-list">
                {group.entries.map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Button variant="ghost" testid="clear-history" onClick={() => void clearHistory()}>
        {t('history_clear')}
      </Button>
    </>
  );
}

function dayTitle(daysAgo: number, day: number): string {
  if (daysAgo === 0) return t('day_today');
  if (daysAgo === 1) return t('day_yesterday');
  return new Date(day).toLocaleDateString(uiLanguage(), { day: 'numeric', month: 'long' });
}

/** The YouTube preview, or a tile with the first letter of the site when there is none (or it fails). */
function Thumb({ entry }: { entry: HistoryEntry }) {
  const video = youtubeVideoId(entry.url);
  const [failed, setFailed] = useState(false);
  if (video && !failed)
    return (
      <img
        class="thumb"
        src={`https://i.ytimg.com/vi/${video}/mqdefault.jpg`}
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  const letter =
    entry.host
      .replace(/^www\./, '')
      .charAt(0)
      .toUpperCase() || '▶';
  return (
    <span class="thumb tile" aria-hidden="true">
      {letter}
    </span>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const progress = entry.duration > 0 ? Math.min(1, entry.position / entry.duration) : 0;
  return (
    <li class="history-item" data-testid="history-item">
      <Thumb entry={entry} />
      <span class="grow">
        <div class="title" title={entry.title}>
          {entry.title}
        </div>
        <div class="meta">
          {entry.host.replace(/^www\./, '')}
          {entry.duration > 0 && ` · ${formatDuration(entry.duration)}`}
        </div>
        <a
          class="page-url"
          data-testid="history-url"
          href={resumeUrl(entry)}
          target="_blank"
          rel="noreferrer"
          title={entry.url}
        >
          {displayUrl(entry.url)}
        </a>
        {progress > 0.02 && (
          <span class="progress-row">
            <Progress value={progress} />
            <small>{Math.round(progress * 100)}%</small>
          </span>
        )}
      </span>
      <button
        class="play-btn"
        type="button"
        title={t('history_resume')}
        aria-label={t('history_resume_item', entry.title)}
        data-testid="history-open"
        onClick={() => void browser.tabs.create({ url: resumeUrl(entry) })}
      >
        {Icons.play}
      </button>
      <button
        class="icon-btn"
        type="button"
        title={t('remove')}
        aria-label={t('remove_item', entry.title)}
        onClick={() => void removeHistoryEntry(entry.id)}
      >
        {Icons.trash}
      </button>
    </li>
  );
}
