import { expect, test } from '@playwright/test';
import { launchWithExtension } from './extension';

test('a user who never chose a language gets the one of the browser, and it is saved', async () => {
  const session = await launchWithExtension({ language: 'auto' });
  try {
    const panel = await session.context.newPage();
    // Headless Chromium keeps no language of its own to set; the panel is told the browser speaks Russian.
    await panel.addInitScript(() => {
      chrome.i18n.getUILanguage = () => 'ru-RU';
    });
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('tab-settings')).toHaveText('Настройки');
    await expect(panel.getByTestId('ui-language')).toHaveValue('ru');
    const stored = await session.worker.evaluate(async () => {
      const got = await chrome.storage.local.get('uiLanguage');
      return (got.uiLanguage as { code: string }).code;
    });
    expect(stored).toBe('ru');
  } finally {
    await session.close();
  }
});

test('a language the user chose is not replaced by the one of the browser', async () => {
  const session = await launchWithExtension({ language: 'en' });
  try {
    const panel = await session.context.newPage();
    await panel.addInitScript(() => {
      chrome.i18n.getUILanguage = () => 'ru-RU';
    });
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await expect(panel.getByTestId('tab-settings')).toHaveText('Settings');
  } finally {
    await session.close();
  }
});
