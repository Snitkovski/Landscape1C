# Бот опроса популярности

Телеграм-бот [@stateOf1c_bot](https://t.me/stateOf1c_bot) — сбор данных о реальной
востребованности инструментов ландшафта (замысел — `docs/TZ.md`, п.13). Живет
отдельно от сайта: собирает ответы волнами по годам, публикация на карточках —
отдельный шаг после проверки данных. Ноль зависимостей: системный Node.js,
Bot API через long polling.

## Запуск

```bash
BOT_TOKEN=<токен> node bot/bot.js
```

- Токен — у [@BotFather](https://t.me/BotFather); если засветился — перевыпустить (`/revoke`).
- Для боевой волны задать свою соль обезличивания: `BOT_SALT=<секрет>`.
- Перед волной прогнать самопроверку: `node bot/validate.js`.
- Работает на любой ОС: логотипы пререндерены заранее (см. ниже).

Сводка по собранному (метрики State of JS: узнаваемость, использование,
retention, интерес):

```bash
node bot/report.js               # все респонденты
node bot/report.js разработчик   # срез по роли респондента
```

## Развертывание (VPS, systemd)

Боту нужны из репозитория `bot/` и `app/` (данные `app/data.js` и растровые
логотипы `app/logos/`) — проще всего клонировать репозиторий целиком.
Юнит — `bot/deploy/stateof1c.service`:

```bash
# на сервере (Ubuntu): Node 22 LTS, пользователь, код
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs
sudo useradd -r -s /usr/sbin/nologin stateof1c
sudo git clone https://github.com/Oxotka/Landscape1C.git /opt/landscape1c
sudo chown -R stateof1c: /opt/landscape1c

# секреты и юнит
printf 'BOT_TOKEN=<токен>\nBOT_SALT=<секрет>\n' | sudo tee /etc/stateof1c.env >/dev/null
sudo chmod 600 /etc/stateof1c.env
sudo cp /opt/landscape1c/bot/deploy/stateof1c.service /etc/systemd/system/
sudo systemctl enable --now stateof1c
journalctl -u stateof1c -f   # лог
```

При переезде с другой машины перенести три файла из `.gitignore` (в
`/opt/landscape1c/bot/`, до старта юнита): `answers.jsonl` (ответы),
`state.json` (сессии), `file-ids.json` (прогретый кэш логотипов — без него
первый показ каждой карточки заново грузит файл). Бот должен быть запущен
**в одном экземпляре**: два long polling на один токен дерутся за апдейты —
перед стартом на сервере остановить локальный.

Бэкап: единственные невосполнимые данные — `answers.jsonl`. На сервере:

```bash
( crontab -l 2>/dev/null; echo '0 3 * * * cp /opt/landscape1c/bot/answers.jsonl /root/backup-answers-$(date +\%u).jsonl' ) | crontab -
```

и время от времени забирать копию к себе:
`scp <сервер>:/opt/landscape1c/bot/answers.jsonl ~/backup/`.

## Устройство

`bot.js` — машина состояний и роутинг апдейтов. Шаги сессии:
`intro → role → level → context → confirm → quiz` (каждые 10 ответов —
`checkpoint`, из него `paused`) `→ offer → done`; `fix` — исправление ответа
по названию инструмента (с чекпоинта или финала). Составные части:

- `lib/telegram.js` — транспорт Bot API голым https, отправка фото с кэшем
  `file_id` (`file-ids.json` — вся скорость в нем), гигиена чата: удаление
  сообщений, тосты, реестр отправленного (на нем полная очистка по «сбросу»).
- `lib/quiz.js` — данные ландшафта (`app/data.js`), исключения и очереди:
  ядро роли = продвинутые + 1 нишевый на каждые 3, после трех «не знаю» подряд
  вперед поднимается массовый инструмент; остаток нишевых — опт-ин после ядра.
- `lib/texts.js` — все тексты и кнопки (авторские тексты онбординга — здесь;
  буква «ё» не используется).
- `lib/logos.js` — поиск логотипа карточки (PNG из `logos-png/`, растровые —
  из `app/logos/`).
- `lib/store.js` — журнал ответов, состояние сессий, обезличивание. Замена
  файлов на БД трогает только этот модуль.

## Логотипы

Телеграм не принимает SVG, поэтому векторные логотипы рендерятся заранее и
коммитятся в `bot/logos-png/`:

```bash
node bot/render-logos.js         # только недостающие (после новых логотипов)
node bot/render-logos.js --all   # перерендерить все заново
```

Рендер требует macOS (qlmanage) — поэтому он и вынесен из бота: на сервере
рендерить нечем, PNG уже в репозитории.

## Данные

- `answers.jsonl` (в `.gitignore`) — по строке на ответ:
  `{ts, wave, uid, role, level, context, block, tool, answer, sentiment}`.
  `role` — роль респондента (из онбординга), `block` — чей блок инструментов
  проходился (опт-ин в чужие роли не смешивается со срезами), `uid` — соленый
  хеш телеграм-аккаунта. Последний ответ по инструменту побеждает —
  перепрохождения и исправления не дублируют (дедуп в `report.js`).
- `state.json` (в `.gitignore`) — состояние сессий: прогресс, очередь,
  реестр сообщений.
- `excluded.json` (коммитится) — универсальные инструменты, о которых не
  спрашиваем: их использовали все, в итогах пойдут как «не применимо».
  Имена сверяются с `data.js` при старте и в `validate.js`.

Номер волны — константа `WAVE` в `bot.js`.
