// Телеграм-бот опроса популярности инструментов ландшафта (docs/TZ.md, п.13).
// Здесь только машина состояний и роутинг апдейтов, остальное по модулям:
//   lib/telegram.js — транспорт Bot API, кэш file_id, гигиена чата
//   lib/quiz.js     — данные ландшафта, исключения, построение очередей
//   lib/texts.js    — все тексты и кнопки
//   lib/logos.js    — пререндеренные логотипы (готовит bot/render-logos.js)
//   lib/store.js    — журнал ответов, состояние сессий, обезличивание
// Запуск: BOT_TOKEN=<токен от @BotFather> node bot/bot.js
// Шаги сессии: intro → role → level → context → confirm → quiz
// (каждые 10 ответов checkpoint, из него paused) → offer → done;
// fix — исправление ответа по названию (с чекпоинта или финала).
"use strict";
const { api, send, sendPhoto, hideCard, toast } = require("./lib/telegram");
const { T, K, CHEERS, ansRow, btnRows } = require("./lib/texts");
const {
    ROLES,
    CONTEXTS,
    LEVELS,
    L,
    EXCLUDED,
    badExcluded,
    byName,
    buildQueue,
    nichePool,
    promoteMainstream,
} = require("./lib/quiz");
const { logoFile } = require("./lib/logos");
const {
    state,
    saveState,
    uid,
    saveAnswer,
    myAnswers,
    eraseAnswers,
} = require("./lib/store");

const WAVE = 2026; // волна сбора; данные публикуются после отсечки

// ── Карточки ──
// s.role — роль респондента (из онбординга, не меняется);
// s.block — роль, чьи инструменты сейчас показываем (ядро = своя роль, дальше опт-ин)
// Отправка карточки: фото с фолбэком на текст; прошлая неотвеченная
// карточка убирается — повторная отправка не плодит дубли
async function postCard(chat, s, i, text) {
    if (s.cardMsg) hideCard(chat, s.cardMsg);
    const logo = logoFile(i);
    const msg = logo
        ? await sendPhoto(chat, logo, text, K.exp).catch(() =>
              send(chat, text, K.exp),
          )
        : await send(chat, text, K.exp);
    s.cardMsg = msg && msg.message_id;
    saveState();
}
async function sendCard(chat, s) {
    if (s.pos >= s.queue.length) return offerMore(chat, s);
    const i = byName(s.queue[s.pos]);
    return postCard(chat, s, i, T.card(i, s.pos, s.queue.length));
}
// Карточка исправления: тот же вопрос, но вне очереди опроса.
// Запоминаем, откуда пришли (финал или чекпоинт), чтобы вернуться туда же
async function sendFixCard(chat, s, name) {
    if (s.step !== "fix") s.fixReturn = s.step;
    s.step = "fix";
    s.fixTool = name;
    saveState();
    const i = byName(name);
    return postCard(chat, s, i, T.fixCard(i));
}

// ── Конец блока: предложение продолжить и финал ──
async function offerMore(chat, s) {
    if (!s.doneRoles.includes(s.block)) s.doneRoles.push(s.block);
    const rest = ROLES.filter((r) => !s.doneRoles.includes(r));
    const counts = rest
        .map((r) => ({ r, n: buildQueue(r, s.answered).length }))
        .filter((x) => x.n > 0);
    // Первой — добивка своей роли (оставшиеся нишевые; без слова «нишевые»:
    // для пользователя это просто инструменты), ниже — чужие роли
    const rows = [];
    const niche = nichePool(s).length;
    if (niche) rows.push([K.nicheBtn(niche)]);
    counts.forEach((x) => rows.push([K.roleBtn(x.r, x.n)]));
    if (!rows.length) return finish(chat, s);
    s.step = "offer";
    saveState();
    await send(chat, T.offer(s.answered.length), rows.concat([[K.finishBtn]]));
}

async function finish(chat, s) {
    s.step = "done";
    saveState();
    await send(chat, T.finish(s.answered.length, WAVE), K.myAnswers);
}

// ── Итоговый список и исправление ответов ──
const ANS_ORDER = { работал: 0, слышал: 1, "не знаю": 2 };
const PAGE = 40;
async function sendSummary(chat, page) {
    const rows = myAnswers(chat);
    if (!rows.length) return toast(chat, T.noAnswers);
    rows.sort(
        (a, b) =>
            ANS_ORDER[a.answer] - ANS_ORDER[b.answer] ||
            a.tool.localeCompare(b.tool, "ru"),
    );
    const pages = Math.ceil(rows.length / PAGE);
    const p = Math.min(Math.max(page, 0), pages - 1);
    const lines = rows.slice(p * PAGE, p * PAGE + PAGE).map(ansRow);
    const nav = [];
    if (p > 0) nav.push({ text: "⬅️", callback_data: `sum:${p - 1}` });
    if (p < pages - 1) nav.push({ text: "➡️", callback_data: `sum:${p + 1}` });
    // Листание заменяет прошлую страницу, а не копит их
    const s = state[chat];
    if (s && s.sumMsg) hideCard(chat, s.sumMsg);
    const msg = await send(
        chat,
        T.summary(lines, p, pages),
        nav.length ? [nav] : undefined,
    ).catch(() => null);
    if (s) {
        s.sumMsg = msg && msg.message_id;
        saveState();
    }
}
// Исправление записано — возвращаемся, откуда пришли (финал или чекпоинт)
async function fixDone(chat, s, what) {
    const back = s.fixReturn || "done";
    s.step = back;
    s.fixReturn = null;
    saveState();
    if (back === "checkpoint") {
        // Старый чекпоинт заменяем свежим — сводка уже с исправлением,
        // вдруг нужно поправить что-то еще
        if (s.cpMsg) hideCard(chat, s.cpMsg);
        const msg = await send(
            chat,
            T.fixedAtCheckpoint(what, s.cp),
            K.checkpoint,
        ).catch(() => null);
        s.cpMsg = msg && msg.message_id;
        saveState();
        return;
    }
    return toast(chat, T.fixed(what));
}

// ── Онбординг ──
async function startIntro(chat, keepAnswered) {
    state[chat] = {
        step: "intro",
        answered: keepAnswered || [],
        doneRoles: [],
    };
    saveState();
    await send(chat, T.intro, K.intro);
}
const askRole = (chat) => send(chat, T.role, btnRows(ROLES, "role"));

// ── Запись ответа и продвижение по очереди ──
function record(s, chat, tool, answer, sentiment) {
    saveAnswer({
        ts: new Date().toISOString(),
        wave: WAVE,
        uid: uid(chat),
        role: s.role,
        level: s.level,
        context: s.context,
        block: s.block,
        tool,
        answer,
        sentiment,
    });
    // При исправлении инструмент уже в answered — не дублируем
    if (!s.answered.includes(tool)) s.answered.push(tool);
    if (s.step === "fix") {
        // Исправление: правим строку в сводке чекпоинта (если она там),
        // текущую десятку и серию «не знаю» не трогаем
        const row = s.cp && s.cp.list.find((r) => r.tool === tool);
        if (row) {
            row.answer = answer;
            row.sentiment = sentiment;
        }
        return;
    }
    // Серия «не знаю» подряд — для адаптивного порядка очереди
    s.streak = answer === "не знаю" ? (s.streak || 0) + 1 : 0;
    // Последняя десятка — для сводки на чекпоинте
    s.recent = s.recent || [];
    s.recent.push({ tool, answer, sentiment });
    if (s.recent.length > 10) s.recent.shift();
}

async function next(chat, s) {
    s.pos++;
    promoteMainstream(s);
    saveState();
    // Чекпоинт каждые 10 ответов: прогресс + поощрялка + продолжить/пауза,
    // следующая карточка не шлется, пока не нажали «Продолжаем»
    if (s.pos % 10 === 0 && s.pos < s.queue.length) {
        const p = s.pos / s.queue.length;
        const tier = CHEERS[p < 0.4 ? 0 : p < 0.75 ? 1 : 2];
        s.cheered = s.cheered || [];
        let pool = tier.filter((c) => !s.cheered.includes(c));
        if (!pool.length) pool = tier; // пул исчерпан — идем по второму кругу
        const cheer = pool[Math.floor(Math.random() * pool.length)];
        s.cheered.push(cheer);
        s.step = "checkpoint";
        // Сводку держим в s.cp — после исправления перерисуем ее заново
        s.cp = { list: s.recent || [], pos: s.pos, total: s.queue.length };
        s.recent = [];
        const msg = await send(
            chat,
            T.checkpoint(s.cp, cheer),
            K.checkpoint,
        ).catch(() => null);
        s.cpMsg = msg && msg.message_id; // уберем, каким бы путем ни ушли
        saveState();
        return;
    }
    await sendCard(chat, s);
}

// ── Роутинг входящих сообщений ──
const RESET_WORDS = ["/reset", "сброс", "сбросить", "заново"];
async function onMessage(m) {
    const chat = m.chat.id;
    const s = state[chat];
    // Сообщения пользователя тоже убираем — чат держим максимально чистым
    hideCard(chat, m.message_id);
    const cmd = (m.text || "").trim().toLowerCase();
    // Сброс: стираем ответы и прогресс пользователя (с подтверждением)
    if (RESET_WORDS.includes(cmd) && s) {
        return send(chat, T.resetConfirm, K.reset);
    }
    if (m.text === "/start" || !s) {
        return startIntro(chat, s && s.answered);
    }
    // Любой текст посреди опроса — повторяем текущий шаг
    if (s.step === "quiz") await sendCard(chat, s);
    else if (s.step === "paused") {
        if (s.pauseMsg) hideCard(chat, s.pauseMsg);
        s.pauseMsg = null;
        s.step = "quiz";
        saveState();
        await toast(chat, T.welcomeBack);
        await sendCard(chat, s);
    } else if (
        s.step === "done" ||
        s.step === "fix" ||
        s.step === "checkpoint"
    ) {
        // После финиша и на чекпоинте текст — поиск инструмента для исправления
        const query = (m.text || "").trim().toLowerCase();
        if (!query) return;
        const cand = myAnswers(chat)
            .map((r) => r.tool)
            .filter((n) => {
                const i = byName(n);
                const hay = [n, ...((i && i.aliases) || [])]
                    .join(" ")
                    .toLowerCase();
                return hay.includes(query);
            });
        if (!cand.length) return toast(chat, T.notFound, 6000);
        if (cand.length === 1) return sendFixCard(chat, s, cand[0]);
        if (cand.length > 6) return toast(chat, T.tooMany(cand.length), 5000);
        s.fixList = cand;
        saveState();
        return send(
            chat,
            T.whichOne,
            cand.map((n, i) => [{ text: n, callback_data: `fixpick:${i}` }]),
        );
    }
}

// ── Роутинг нажатий кнопок ──
async function onCallback(q) {
    const chat = q.message.chat.id;
    const s = state[chat];
    // Не ждем подтверждение нажатия — экономим круг до сервера на каждом тапе
    api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (!s) return;
    const [kind, val] = q.data.split(/:(.*)/);

    if (kind === "reset") {
        // Служебные сообщения сброса в чате не задерживаются
        hideCard(chat, q.message.message_id);
        if (val === "no") return;
        eraseAnswers(chat);
        // Вычищаем с экрана все, что бот присылал (реестр s.msgs),
        // с разбежкой по времени — чтобы не упереться в лимиты API
        (s.msgs || []).forEach((id, i) =>
            setTimeout(() => hideCard(chat, id), i * 40),
        );
        delete state[chat];
        saveState();
        await toast(chat, T.erased);
        return startIntro(chat);
    }
    if (kind === "go" && s.step === "intro") {
        hideCard(chat, q.message.message_id); // онбординг не захламляет чат
        s.step = "role";
        saveState();
        return askRole(chat);
    }
    if (kind === "role" && s.step === "role") {
        hideCard(chat, q.message.message_id);
        s.role = val;
        s.step = "level";
        saveState();
        return send(chat, T.level, btnRows(LEVELS, "level", 3));
    }
    if (kind === "level" && s.step === "level") {
        hideCard(chat, q.message.message_id);
        s.level = val;
        s.step = "context";
        saveState();
        return send(chat, T.context, btnRows(CONTEXTS, "ctx"));
    }
    if (kind === "ctx" && s.step === "context") {
        hideCard(chat, q.message.message_id);
        s.context = val;
        s.step = "confirm";
        saveState();
        const n = buildQueue(s.role, s.answered).length;
        return send(chat, T.confirm(s, n), K.confirm);
    }
    if (kind === "ok" && s.step === "confirm") {
        hideCard(chat, q.message.message_id);
        s.block = s.role;
        s.queue = buildQueue(s.block, s.answered);
        s.pos = 0;
        s.step = "quiz";
        saveState();
        return sendCard(chat, s);
    }
    if (kind === "redo" && s.step === "confirm") {
        hideCard(chat, q.message.message_id);
        s.step = "role";
        saveState();
        return askRole(chat);
    }
    if (kind === "a" && (s.step === "quiz" || s.step === "fix")) {
        // Висящий сентимент прошлой карточки — дозаписываем без него
        if (s.pending) {
            record(s, chat, s.pending.tool, s.pending.answer, null);
            s.pending = null;
        }
        const isFix = s.step === "fix";
        const tool = isFix ? s.fixTool : s.queue[s.pos];
        if (val === "не знаю") {
            record(s, chat, tool, val, null);
            hideCard(chat, q.message.message_id); // не ждем — следующая карточка уходит сразу
            if (isFix) return fixDone(chat, s, T.fixedUnknown(tool));
            return next(chat, s);
        }
        s.pending = { tool, answer: val, fix: isFix };
        saveState();
        return api("editMessageReplyMarkup", {
            chat_id: chat,
            message_id: q.message.message_id,
            reply_markup: { inline_keyboard: K.sent[val] },
        }).catch(() => send(chat, T.sentFallback(val), K.sent[val]));
    }
    if (kind === "s" && s.pending) {
        const { tool, answer, fix } = s.pending;
        record(s, chat, tool, answer, val === "-" ? null : val);
        s.pending = null;
        hideCard(chat, q.message.message_id);
        if (fix) return fixDone(chat, s, T.fixedMark(tool));
        return next(chat, s);
    }
    if (kind === "sum") return sendSummary(chat, +val || 0);
    if (kind === "fixpick" && s.fixList && s.fixList[+val]) {
        hideCard(chat, q.message.message_id); // «Какой из них?» больше не нужен
        const name = s.fixList[+val];
        s.fixList = null;
        return sendFixCard(chat, s, name);
    }
    if (kind === "cont" && s.step === "checkpoint") {
        hideCard(chat, q.message.message_id); // чекпоинт с итогами тоже убираем
        s.cpMsg = null;
        s.step = "quiz";
        saveState();
        return sendCard(chat, s);
    }
    if (kind === "pause" && s.step === "checkpoint") {
        hideCard(chat, q.message.message_id);
        s.cpMsg = null;
        s.step = "paused";
        const note = await send(chat, T.paused).catch(() => null);
        s.pauseMsg = note && note.message_id; // удалим при возвращении
        saveState();
        return;
    }
    if (kind === "more" && s.step === "offer") {
        hideCard(chat, q.message.message_id);
        if (val === "-") return finish(chat, s);
        if (val === "~niche") {
            // Отложенные нишевые: блоком остается своя роль
            s.block = s.role;
            s.queue = nichePool(s);
        } else {
            s.block = val;
            s.queue = buildQueue(val, s.answered);
        }
        s.pos = 0;
        s.step = "quiz";
        saveState();
        return sendCard(chat, s);
    }
}

// ── Long polling ──
(async () => {
    badExcluded().forEach((n) =>
        console.error(`⚠ excluded.json: «${n}» не найден в data.js`),
    );
    console.log(
        `Бот запущен. Волна ${WAVE}. Инструментов: ${L.items.length}, исключено из опроса: ${EXCLUDED.length}.`,
    );
    // Чаты обрабатываются параллельно, внутри чата — строго по очереди
    // (цепочка промисов на чат): медленный чат не тормозит остальных,
    // а два быстрых тапа одного пользователя не гоняются друг с другом
    const chains = new Map();
    const dispatch = (chat, fn) => {
        const tail = (chains.get(chat) || Promise.resolve())
            .then(fn)
            .catch(console.error);
        chains.set(chat, tail);
        tail.finally(() => {
            if (chains.get(chat) === tail) chains.delete(chat);
        });
    };
    let offset = 0;
    for (;;) {
        try {
            const updates = await api("getUpdates", { offset, timeout: 50 });
            for (const u of updates) {
                offset = u.update_id + 1;
                if (u.message)
                    dispatch(u.message.chat.id, () => onMessage(u.message));
                if (u.callback_query && u.callback_query.message)
                    dispatch(u.callback_query.message.chat.id, () =>
                        onCallback(u.callback_query),
                    );
            }
        } catch (e) {
            console.error("poll:", e.message);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
})();
