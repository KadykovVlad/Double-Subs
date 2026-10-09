# Double Sub — Privacy Policy / Политика конфиденциальности

Черновик для публикации (этап 18). Версия расширения 0.0.1. Юридическую вычитку сделать до подачи в магазин.

## English

**Double Sub shows dual subtitles (English + Russian) over HTML5 video players and translates words on hover.**

**What stays on your computer.** Everything the extension does happens in your browser:
- Subtitles are read from the video player on the page you open the extension on.
- Missing subtitle lines are translated by Chrome's built-in on-device Translator API. The text is not sent to us or to any server of ours.
- Translated lines and single words are cached in the extension's own storage on your computer.
- Your settings, the list of sites you switched automatic start on, the words you saved (with their repetition schedule) and the list of videos you watched with Double Sub (page address, title, the place where you stopped) are kept in `chrome.storage.local`. They are not uploaded anywhere. The history can be switched off and cleared in the settings.

**What we do not do.** We have no servers, no accounts and no analytics in this version. We do not collect, sell or share personal data, browsing history, page content or the videos you watch. We do not use remote code.

**Third parties.**
- *YouTube.* On YouTube the extension asks YouTube for the subtitles of the video you are watching (including YouTube's own machine translation), the same way the YouTube player does. This request goes to YouTube, not to us.
- *Chrome's language model.* The first translation downloads Chrome's translation model; Chrome manages that download.
- *Voices.* Words are read aloud with the voices of your system (`chrome.tts`). The extension picks a voice built into your system; if you choose an online voice yourself in the settings, Chrome may send the spoken word to that voice's provider.

**Access to sites.** The extension reads a page only after you click its icon (the `activeTab` permission), on YouTube, and on sites where you ticked "start automatically". Access to another site (for example a player embedded from another domain) is requested separately, for that site only, and can be taken back with the "Remove" button in the extension.

**Recognising your sites by name (optional).** If you switch on "recognise my sites on other addresses", the extension asks for access to all sites. It uses it for one thing only: to compare the address of a page with the list of sites you chose (so that a mirror of a site you use, like a new domain with the same name, starts by itself). On all other pages it does nothing and reads nothing. You can switch it off at any time, and the access is taken back.

**Your control.** Remove a site from the list, delete saved words, or uninstall the extension to delete all of its data.

**Changes.** When accounts and a paid plan appear, this policy will be updated before they are enabled and the new data (account e-mail, synced words) will be described here.

## Русский

**Double Sub показывает двойные субтитры (английские и русские) поверх HTML5-плееров и переводит слова при наведении.**

**Что остаётся на вашем компьютере.** Всё работает в браузере:
- субтитры читаются из плеера на странице, на которой вы открыли расширение;
- недостающая строка переводится встроенным переводчиком Chrome прямо на устройстве, текст не отправляется ни нам, ни на какие наши серверы;
- переводы кэшируются в хранилище расширения на вашем компьютере;
- настройки, список сайтов с автозапуском, сохранённые слова (с графиком повторения) и история просмотра (адрес страницы, название, место остановки) лежат в `chrome.storage.local` и никуда не передаются. Историю можно выключить и очистить в настройках.

**Чего мы не делаем.** В этой версии нет серверов, аккаунтов и аналитики. Мы не собираем, не продаём и не передаём личные данные, историю, содержимое страниц и то, что вы смотрите. Удалённый код не используется.

**Файлы субтитров.** Если плеер держит субтитры вне стандартных дорожек, расширение скачивает файлы `.vtt` и `.srt`, которые страница уже запрашивала сама, теми же правами, что у страницы (не более 6 файлов по 2 МБ). Больше ничего по этим адресам не отправляется, а сами файлы читаются только на устройстве.

**Третьи стороны.** YouTube (запрашиваем субтитры текущего ролика так же, как его плеер), модель перевода Chrome (скачивает сам Chrome), системные голоса для озвучки слов (используется встроенный голос системы; если вы сами выберете онлайн-голос, Chrome может отправить произносимое слово его поставщику).

**Доступ к сайтам.** Расширение читает страницу только после клика по значку, на YouTube и на сайтах, где вы включили «Запускать автоматически». Доступ к другому сайту (например, плеер с другого домена) запрашивается отдельно и только для него; его можно отозвать кнопкой «Убрать».

**Узнавание ваших сайтов по названию (по желанию).** Если вы включите «Узнавать мои сайты на других адресах», расширение попросит доступ ко всем сайтам. Он нужен только затем, чтобы сравнить адрес страницы со списком сайтов, который вы выбрали (чтобы зеркало знакомого сайта с тем же названием запускалось само). На остальных страницах расширение ничего не делает и ничего не читает. Выключить можно в любой момент, доступ при этом отзывается.

**Ваш контроль.** Уберите сайт из списка, удалите сохранённые слова или само расширение — данные удалятся.

**Изменения.** Когда появятся аккаунты и платный тариф, политика будет обновлена до их включения.
