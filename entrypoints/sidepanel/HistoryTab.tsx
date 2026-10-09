import {
  clearHistory,
  displayUrl,
  removeHistoryEntry,
  resumeUrl,
  type HistoryEntry,
} from '../../src/lib/history';
import { useHistory, useSettings } from './hooks';
import { Button, Card, Empty, Icons, Progress, timeAgo } from './ui';
import { t } from '../../src/lib/i18n';

export function HistoryTab() {
  const list = useHistory();
  const [settings] = useSettings();

  if (list.length === 0) {
    return (
      <Card>
        <Empty icon={Icons.history} title={t('history_empty_title')}>
          {t(settings.keepHistory ? 'history_empty_on' : 'history_empty_off')}
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <ul class="list" data-testid="history-list">
          {list.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </Card>
      <Button variant="ghost" testid="clear-history" onClick={() => void clearHistory()}>
        {t('history_clear')}
      </Button>
    </>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const progress = entry.duration > 0 ? entry.position / entry.duration : 0;
  return (
    <li class="history-item" data-testid="history-item">
      <span class="grow">
        <div class="title" title={entry.title}>
          {entry.title}
        </div>
        <div class="meta">
          {entry.host} · {timeAgo(entry.lastAt)}
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
        {progress > 0.02 && <Progress value={progress} />}
      </span>
      <button
        class="icon-btn"
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
