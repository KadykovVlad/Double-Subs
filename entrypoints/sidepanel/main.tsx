import { render } from 'preact';
import { App } from './App';
import './panel.css';
import { ensureUiLanguage, loadUiLanguage } from '../../src/lib/ui-language';

// The texts are read in the language the user chose before the first draw; the panel follows a change (App).
void ensureUiLanguage()
  .then(loadUiLanguage)
  .then(() => render(<App />, document.getElementById('app')!));
