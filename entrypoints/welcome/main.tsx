import { render } from 'preact';
import { App } from './App';
import '../sidepanel/panel.css';
import { loadUiLanguage } from '../../src/lib/ui-language';

void loadUiLanguage().then(() => render(<App />, document.getElementById('app')!));
