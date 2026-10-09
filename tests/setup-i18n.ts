import ru from '../locales/ru.json';
import { setUiLanguage } from '../src/lib/i18n';

/** The unit tests read the interface in Russian (the texts the tests are written against). */
setUiLanguage('ru', ru as Record<string, string>);
