import { render } from 'preact';
import { App } from './App';
import '../sidepanel/panel.css';
import { ensureUiLanguage, loadUiLanguage } from '../../src/lib/ui-language';

void ensureUiLanguage()
  .then(loadUiLanguage)
  .then(() => render(<App />, document.getElementById('app')!));
