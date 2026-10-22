# Double Sub — Privacy Policy / Политика конфиденциальности

Черновик для публикации (этап 18). Версия расширения 0.0.1. Юридическую вычитку сделать до подачи в магазин.

## English

**Double Sub shows dual subtitles (English + Russian) over HTML5 video players and translates words on hover.**

**What stays on your computer.** Everything the extension does happens in your browser:
- Subtitles are read from the video player on the page you open the extension on.
- Missing subtitle lines are translated by Chrome's built-in on-device Translator API. The text is not sent to us or to any server of ours.
- Translated lines and single words are cached in the extension's own storage on your computer.
- Your settings, the list of sites you switched automatic start on, the words you saved (with their repetition schedule) and the list of videos you watched with Double Sub (page address, title, the place where you stopped) are kept in `chrome.storage.local`. They are not uploaded anywhere. The history can be switched off and cleared in the settings. For YouTube videos in the history, and for the one the panel works with, the panel shows their preview picture, loaded from YouTube's image server (`i.ytimg.com`) without a referrer; other sites get a letter tile and nothing is loaded.

**Account (required).** The extension works after you sign in with Google; before that it does nothing on any page. Until you sign in, the side panel shows one card with the choice of language, the request for access to the sites and the sign-in, each with a click (a mark on the icon tells you to open it). When you sign in:
- Google gives the extension an ID token for your Google account (we ask only for `openid`, `email` and `profile`). The extension sends it to our server (a Cloudflare Worker with a database), which checks it with Google's public keys.
- The server stores the Google account identifier, your e-mail address, your plan (free or Pro) and the sign-in sessions of your browsers (only a hash of the renewal token). Nothing else is uploaded in this version: your words, history and settings stay on your computer. The sign-in sessions use tokens kept in `chrome.storage.local`.
- "Sign out" in the settings ends the session on the server and removes the tokens from the browser; the extension then stops working until the next sign-in. Deleting the account with the data stored for it on the server will be offered in the settings before synchronisation of words and history is switched on.

**What we do not do.** We have no analytics. We do not collect, sell or share personal data, browsing history, page content or the videos you watch. We do not use remote code.

**Third parties.**
- *YouTube.* On YouTube the extension asks YouTube for the subtitles of the video you are watching (including YouTube's own machine translation), the same way the YouTube player does. This request goes to YouTube, not to us.
- *Chrome's language model.* The first translation downloads Chrome's translation model; Chrome manages that download.
- *Voices.* Words are read aloud with the voices of your system (`chrome.tts`). The extension picks a voice built into your system; if you choose an online voice yourself in the settings, Chrome may send the spoken word to that voice's provider.

**Access to sites.** In the card of the side panel (and later with the switch "Start by itself on every site" in the settings) you can allow access to all sites. Then a small script runs in every page and every frame. It does not read the page: it only waits for a `<video>` to appear, and only when one does, the extension reads that video's subtitles. You can switch a site off with "Work on this site" in the panel; the script then does nothing there. If you do not allow access to all sites, the extension reads a page only after you click its icon (the `activeTab` permission), on YouTube, and on sites where you ticked "start automatically"; access to another site is requested separately, for that site only, and can be taken back with the "Remove" button.

**Starting on every site (optional).** The switch "Start by itself on every site" asks for access to all sites, so that the subtitles begin on any page with a video without a click. The script it runs only waits for a video to appear (see above). You can switch it off at any time, and the access is taken back.

**Your control.** Remove a site from the list, delete saved words, or uninstall the extension to delete all of its data.

**Changes.** Before synchronisation of words, history and settings, and before a paid plan, are switched on, this policy will be updated and the new data will be described here.

## Русский

**Double Sub показывает двойные субтитры (английские и русские) поверх HTML5-плееров и переводит слова при наведении.**

**Что остаётся на вашем компьютере.** Всё работает в браузере:
- субтитры читаются из плеера на странице, на которой вы открыли расширение;
- недостающая строка переводится встроенным переводчиком Chrome прямо на устройстве, текст не отправляется ни нам, ни на какие наши серверы;
- переводы кэшируются в хранилище расширения на вашем компьютере;
- настройки, список сайтов с автозапуском, сохранённые слова (с графиком повторения) и история просмотра (адрес страницы, название, место остановки) лежат в `chrome.storage.local` и никуда не передаются. Историю можно выключить и очистить в настройках. Для видео YouTube в истории и для видео, с которым работает панель, показывается превью, загружая картинку с сервера изображений YouTube (`i.ytimg.com`) без адреса страницы; для других сайтов — плитка с буквой, ничего не загружается.

**Аккаунт (обязателен).** Расширение работает после входа через Google; до этого оно ничего не делает ни на одной странице. Пока вы не вошли, боковая панель показывает одну карточку: выбор языка, запрос доступа к сайтам и вход, каждое по клику (отметка на значке подсказывает, что панель нужно открыть). При входе:
- Google выдаёт расширению ID-токен вашего аккаунта (запрашиваем только `openid`, `email` и `profile`). Расширение отправляет его на наш сервер (Cloudflare Worker с базой данных), который проверяет его по открытым ключам Google;
- сервер хранит идентификатор аккаунта Google, ваш адрес электронной почты, тариф (бесплатный или Pro) и сеансы входа ваших браузеров (от токена обновления хранится только хэш). Больше в этой версии ничего не загружается: слова, история и настройки остаются на вашем компьютере. Токены сеанса лежат в `chrome.storage.local`;
- «Выйти» в настройках завершает сеанс на сервере и удаляет токены из браузера; после этого расширение не работает до следующего входа. Удаление аккаунта вместе с данными на сервере появится в настройках до включения синхронизации слов и истории.

**Чего мы не делаем.** У нас нет аналитики. Мы не собираем, не продаём и не передаём личные данные, историю, содержимое страниц и то, что вы смотрите. Удалённый код не используется.

**Файлы субтитров.** Если плеер держит субтитры вне стандартных дорожек, расширение скачивает файлы `.vtt` и `.srt`, которые страница уже запрашивала сама, теми же правами, что у страницы (не более 6 файлов по 2 МБ). Больше ничего по этим адресам не отправляется, а сами файлы читаются только на устройстве.

**Третьи стороны.** YouTube (запрашиваем субтитры текущего ролика так же, как его плеер), модель перевода Chrome (скачивает сам Chrome), системные голоса для озвучки слов (используется встроенный голос системы; если вы сами выберете онлайн-голос, Chrome может отправить произносимое слово его поставщику).

**Доступ к сайтам.** Расширение читает страницу только после клика по значку, на YouTube и на сайтах, где вы включили «Запускать автоматически». Доступ к другому сайту (например, плеер с другого домена) запрашивается отдельно и только для него; его можно отозвать кнопкой «Убрать».

**Запуск на любом сайте (по желанию).** В карточке боковой панели (и позже переключателем «Запускаться само на любом сайте» в настройках) можно разрешить доступ ко всем сайтам. Тогда на каждой странице и в каждом фрейме работает небольшой скрипт. Он не читает страницу: он только ждёт, когда на ней появится `<video>`, и лишь тогда расширение читает субтитры этого видео. Сайт можно отключить переключателем «Работать на этом сайте» в панели, после этого скрипт там ничего не делает. Выключить можно в любой момент, доступ при этом отзывается.

**Ваш контроль.** Уберите сайт из списка, удалите сохранённые слова или само расширение — данные удалятся.

**Изменения.** До включения синхронизации слов, истории и настроек и до появления платного тарифа политика будет обновлена, а новые данные описаны здесь.
