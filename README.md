# Чердак — данные входа для подписки

Расширение для Chrome, которое помогает оформить подписку ChatGPT, Claude, Grok, X или
Cursor в магазине [Чердак](https://shop.cherdak.org) **на твой собственный аккаунт**.

Чтобы оплатить подписку на твой аккаунт, магазину нужны данные входа в него: сессия
ChatGPT, ключ `sessionKey` и Organization ID у Claude, токен входа grok.com. Раньше их
приходилось доставать вручную через инструменты разработчика. Расширение делает это
одной кнопкой: открой сайт сервиса, нажми на значок Чердака, выбери то, что просит заказ
(например, «Скопировать sessionKey»), и вставь результат в заказ.

**Расширение ничего никуда не отправляет.** Оно читает данные только в твоём браузере,
только по нажатию и только с сайта сервиса, и кладёт их в буфер обмена. Единственный
запрос в коде — страница сессии ChatGPT в его же вкладке. Проверь сам,
код небольшой: [`extension/`](extension).

Видео — как достать данные для каждого сервиса: [shop.cherdak.org/extension](https://shop.cherdak.org/extension#video).

## Установка

- **Chrome Web Store** — обычная установка в один клик, обновляется сама.
- **Из GitHub** — скачай `cherdak-extension-X.Y.Z.zip` в [Releases](../../releases),
  распакуй, открой `chrome://extensions`, включи «Режим разработчика» →
  «Загрузить распакованное расширение» → выбери распакованную папку. Так установленное
  расширение Chrome сам не обновляет: новую версию ставь так же из Releases.

Работает в Chrome, Edge, Яндекс Браузере, Brave и других браузерах на Chromium.

## Что копируется

| Сайт | Кнопка | Что ляжет в буфер |
|------|--------|-------------------|
| chatgpt.com | Скопировать сессию | исходный JSON `/api/auth/session` целиком |
| | Скопировать ID аккаунта | `account.id` со страницы сессии — 36 символов |
| | Скопировать все куки | полные записи куки ChatGPT |
| claude.ai | Скопировать sessionKey | ключ `sk-ant-sid…` |
| | Скопировать Organization ID | выбранная организация (`lastActiveOrg`) |
| | Скопировать все куки | полные записи куки claude.ai |
| grok.com, x.com, cursor.com | Скопировать токен входа | токен `sso` с grok.com: единая подписка X, Grok и Cursor включается там |
| | Скопировать все куки | полные записи куки grok.com |

Сайт и бот Чердака принимают эти форматы. Экспорт куки сохраняет все поля браузера, включая домен, путь и раздел хранилища, когда он указан.

## Разрешения

- `cookies` — данные входа хранятся в куки с пометкой httpOnly: страница и обычные
  скрипты их не видят, прочитать их может только расширение.
- `activeTab` — узнать адрес открытой вкладки, когда ты нажал на значок, чтобы показать
  нужный сервис.
- `scripting` — прочитать страницу сессии ChatGPT в его же вкладке для копирования сессии или ID аккаунта.
- Доступ только к `chatgpt.com`, `chat.openai.com`, `claude.ai`, `grok.com`. Ни к каким
  другим сайтам, без фоновой работы и аналитики.

[Политика конфиденциальности](PRIVACY.md).

> Данные входа — это ключ от твоего аккаунта. Вставляй их только в свой заказ на
> shop.cherdak.org или в боте [@cherdax_bot](https://t.me/cherdax_bot), никому не
> пересылай. После активации подписки можно выйти из аккаунта на всех устройствах —
> ключ перестанет работать.

## Разработка

```
extension/          код расширения (это и загружается в Chrome)
  manifest.json
  popup.html, popup.css, popup.js
  extractors.mjs    форматы для буфера обмена
  readers.mjs       чтение страницы сессии и куки
  icons/, fonts/
tests/              node --test
.github/workflows/  test — на каждый push; release — по тегу vX.Y.Z
```

```bash
npm test
```

Посмотреть интерфейс без установки: `npx serve extension` (или любой статический
сервер) и открыть `popup.html` — без API Chrome он покажет экран выбора сервиса.

### Выпуск версии

1. Поднять `version` в `extension/manifest.json`, дописать `CHANGELOG.md`.
2. Закоммитить и поставить тег: `git tag v1.0.1 && git push --tags`.
3. Сборка `release` прогонит тесты, сверит тег с версией, выложит zip в Releases и,
   если в настройках репозитория заданы секреты `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, загрузит и опубликует версию в Chrome Web
   Store. После проверки Google Chrome обновит расширение у всех сам.

Первую публикацию в Chrome Web Store делают вручную — пошагово, с готовыми текстами для формы
магазина и картинками из `store/`: [STORE.md](STORE.md). После неё новые версии уходят в магазин сами.

---

## English

Cherdak is a shop that pays for ChatGPT, Claude, Grok/X and Cursor subscriptions on the
buyer's own account. To do that it needs the account's login data (session cookies),
which buyers used to dig out of DevTools by hand. This extension copies exactly those
values from the open service tab to the clipboard in one click, in the format the shop
accepts. It runs only on click, reads only `chatgpt.com`, `chat.openai.com`, `claude.ai`
and `grok.com` data, stores nothing and sends nothing anywhere; its only request is the
ChatGPT tab reading its own `/api/auth/session` for the full session or account ID.
Licensed under MIT; bundled fonts under SIL OFL 1.1.
