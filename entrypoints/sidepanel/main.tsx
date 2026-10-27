import { render } from 'preact';
import { App } from './App';
import './panel.css';
import { ensureUiLanguage, loadUiLanguage } from '../../src/lib/ui-language';
import { applyTheme, loadTheme } from '../../src/lib/theme';

// The texts are read in the language the user chose before the first draw; the panel follows a change (App).
// The theme the user chose is on the page before the first draw: no flash of the other one.
void loadTheme().then(applyTheme);
void ensureUiLanguage()
  .then(loadUiLanguage)
  .then(() => render(<App />, document.getElementById('app')!));
