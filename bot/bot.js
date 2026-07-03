// Прототип телеграм-бота опроса популярности (docs/TZ.md, п.13).
// Ноль зависимостей: Telegram Bot API через long polling голым https.
// Запуск: BOT_TOKEN=<токен от @BotFather> node bot/bot.js
// Ответы пишутся в bot/answers.jsonl (append-only), состояние сессий — в bot/state.json.
"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error("Нужен токен: BOT_TOKEN=<токен> node bot/bot.js");
    process.exit(1);
}
const WAVE = 2026; // волна сбора; данные публикуются после отсечки
const SALT = process.env.BOT_SALT || "landscape1c-proto"; // для прототипа достаточно

// ── Данные ландшафта ──
global.window = {};
require(path.join(__dirname, "..", "app", "data.js"));
const L = global.window.LANDSCAPE;
const ROLES = L.axes.role.values; // разработчик / администратор / тестировщик / аналитик
const CONTEXTS = L.axes.context.values; // франчайзи / инхаус / продукты / проекты
const LEVELS = ["начинающий", "опытный", "эксперт"];

// ── Логотипы: телеграм не принимает SVG — рендерим в PNG через qlmanage (macOS).
// Кэш в bot/logo-cache/, растровые логотипы берутся из app/logos/ как есть.
const LOGOS = path.join(__dirname, "..", "app", "logos");
const CACHE = path.join(__dirname, "logo-cache");
fs.mkdirSync(CACHE, { recursive: true });
// SVG без viewBox QuickLook рисует мелко в углу холста 512: подставляем
// viewBox из width/height и раздуваем сами width/height до 512 (маленькие
// интринсик-размеры QuickLook не апскейлит) — рендерим правленую копию
const svgSrc = (f) => {
    const orig = path.join(LOGOS, f);
    const raw = fs.readFileSync(orig, "utf8");
    if (/viewBox=/.test(raw)) return orig;
    const m = raw.match(
        /<svg[^>]*?\bwidth="([\d.]+)(?:px)?"[^>]*?\bheight="([\d.]+)(?:px)?"/,
    );
    if (!m) return orig;
    const patched = raw
        .replace(/\bwidth="[\d.]+(?:px)?"/, `width="512"`)
        .replace(
            /\bheight="[\d.]+(?:px)?"/,
            `height="${Math.round((512 * m[2]) / m[1])}"`,
        )
        .replace(/<svg/, `<svg viewBox="0 0 ${m[1]} ${m[2]}"`);
    const tmp = path.join(CACHE, "_src");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, f), patched);
    return path.join(tmp, f);
};
const svgs = [...new Set(L.items.map((i) => i.logo).filter(Boolean))]
    .filter((f) => /\.svg$/i.test(f))
    .filter(
        (f) =>
            fs.existsSync(path.join(LOGOS, f)) &&
            !fs.existsSync(path.join(CACHE, f + ".png")),
    );
if (svgs.length) {
    try {
        execFileSync(
            "qlmanage",
            ["-t", "-s", "512", "-o", CACHE, ...svgs.map(svgSrc)],
            {
                stdio: "ignore",
            },
        );
    } catch (e) {
        console.error("рендер логотипов:", e.message);
    }
    fs.rmSync(path.join(CACHE, "_src"), { recursive: true, force: true });
}
const logoFile = (i) => {
    if (!i.logo) return null;
    const f = /\.svg$/i.test(i.logo)
        ? path.join(CACHE, i.logo + ".png")
        : path.join(LOGOS, i.logo);
    return fs.existsSync(f) ? f : null;
};

// ── Хранилище (прототип: файлы; потом заменяется на БД в этих двух функциях) ──
const ANSWERS = path.join(__dirname, "answers.jsonl");
const STATE = path.join(__dirname, "state.json");
const saveAnswer = (rec) =>
    fs.appendFileSync(ANSWERS, JSON.stringify(rec) + "\n");
let state = {};
try {
    state = JSON.parse(fs.readFileSync(STATE, "utf8"));
} catch (e) {}
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state));
const uid = (id) =>
    crypto
        .createHash("sha256")
        .update(SALT + id)
        .digest("hex")
        .slice(0, 16);

// ── Telegram API ──
const api = (method, params) =>
    new Promise((resolve, reject) => {
        const body = JSON.stringify(params || {});
        const req = https.request(
            {
                hostname: "api.telegram.org",
                path: `/bot${TOKEN}/${method}`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        const j = JSON.parse(data);
                        j.ok
                            ? resolve(j.result)
                            : reject(new Error(j.description));
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        req.on("error", reject);
        req.end(body);
    });
const send = (chat, text, keyboard) =>
    api("sendMessage", {
        chat_id: chat,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    });
// Кэш telegram file_id по файлу логотипа: первый показ грузит файл,
// дальше фото уходит мгновенно по идентификатору — в этом вся скорость
const FILEIDS = path.join(__dirname, "file-ids.json");
let fileIds = {};
try {
    fileIds = JSON.parse(fs.readFileSync(FILEIDS, "utf8"));
} catch (e) {}
const sendPhoto = async (chat, file, caption, keyboard) => {
    if (fileIds[file]) {
        try {
            return await api("sendPhoto", {
                chat_id: chat,
                photo: fileIds[file],
                caption,
                parse_mode: "HTML",
                reply_markup: keyboard
                    ? { inline_keyboard: keyboard }
                    : undefined,
            });
        } catch (e) {} // file_id протух — перезаливаем файлом
    }
    const res = await uploadPhoto(chat, file, caption, keyboard);
    const ph = res.photo && res.photo[res.photo.length - 1];
    if (ph) {
        fileIds[file] = ph.file_id;
        fs.writeFileSync(FILEIDS, JSON.stringify(fileIds));
    }
    return res;
};
// Загрузка фото файлом — multipart руками (зависимостей нет)
const uploadPhoto = (chat, file, caption, keyboard) =>
    new Promise((resolve, reject) => {
        const b = "----landscape" + Date.now();
        const fields = { chat_id: String(chat), caption, parse_mode: "HTML" };
        if (keyboard)
            fields.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
        let head = "";
        for (const [k, v] of Object.entries(fields))
            head += `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
        head += `--${b}\r\nContent-Disposition: form-data; name="photo"; filename="${path.basename(file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const body = Buffer.concat([
            Buffer.from(head),
            fs.readFileSync(file),
            Buffer.from(`\r\n--${b}--\r\n`),
        ]);
        const req = https.request(
            {
                hostname: "api.telegram.org",
                path: `/bot${TOKEN}/sendPhoto`,
                method: "POST",
                headers: {
                    "Content-Type": `multipart/form-data; boundary=${b}`,
                    "Content-Length": body.length,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        const j = JSON.parse(data);
                        j.ok
                            ? resolve(j.result)
                            : reject(new Error(j.description));
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        req.on("error", reject);
        req.end(body);
    });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const btnRows = (labels, prefix, perRow = 2) => {
    const rows = [];
    labels.forEach((l, i) => {
        if (i % perRow === 0) rows.push([]);
        rows[rows.length - 1].push({
            text: l,
            callback_data: `${prefix}:${l}`,
        });
    });
    return rows;
};

// ── Логика опроса ──
const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};
// Очередь роли: карточки роли без уже отвеченных, базовые раньше нишевых,
// внутри уровня зрелости — случайный порядок (без позиционного смещения)
const MAT = { базовое: 0, продвинутое: 1, нишевое: 2 };
const buildQueue = (role, answered) => {
    const pool = L.items.filter(
        (i) => (i.roles || []).includes(role) && !answered.includes(i.name),
    );
    return shuffle(pool)
        .sort((a, b) => (MAT[a.maturity] ?? 9) - (MAT[b.maturity] ?? 9))
        .map((i) => i.name);
};
const byName = (n) => L.items.find((i) => i.name === n);

const EXP_BTNS = [
    [
        { text: "✅ Работал", callback_data: "a:работал" },
        { text: "👂 Слышал", callback_data: "a:слышал" },
    ],
    [{ text: "🤷 Не знаю", callback_data: "a:не знаю" }],
];
const SENT = {
    работал: [
        [
            { text: "👍 Использовал бы снова", callback_data: "s:да" },
            { text: "👎 Не хотел бы", callback_data: "s:нет" },
        ],
        [{ text: "⏭ Дальше", callback_data: "s:-" }],
    ],
    слышал: [
        [
            { text: "🔥 Хочу попробовать", callback_data: "s:да" },
            { text: "😐 Не интересно", callback_data: "s:нет" },
        ],
        [{ text: "⏭ Дальше", callback_data: "s:-" }],
    ],
};

// s.role — роль респондента (из онбординга, не меняется);
// s.block — роль, чьи инструменты сейчас показываем (ядро = своя роль, дальше опт-ин)
async function sendCard(chat, s) {
    if (s.pos >= s.queue.length) return offerMore(chat, s);
    const i = byName(s.queue[s.pos]);
    const text =
        `<b>${esc(i.name)}</b>  <i>(${s.pos + 1}/${s.queue.length})</i>\n\n` +
        esc(i.description) +
        (i.why ? `\n\n💡 ${esc(i.why)}` : "");
    const logo = logoFile(i);
    if (logo)
        await sendPhoto(chat, logo, text, EXP_BTNS).catch(() =>
            send(chat, text, EXP_BTNS),
        );
    else await send(chat, text, EXP_BTNS);
}
// Отвеченная карточка убирается из чата — не копим простыню
const hideCard = (chat, msgId) =>
    api("deleteMessage", { chat_id: chat, message_id: msgId }).catch(() => {});

async function offerMore(chat, s) {
    if (!s.doneRoles.includes(s.block)) s.doneRoles.push(s.block);
    const rest = ROLES.filter((r) => !s.doneRoles.includes(r));
    const counts = rest
        .map((r) => ({ r, n: buildQueue(r, s.answered).length }))
        .filter((x) => x.n > 0);
    if (!counts.length) return finish(chat, s);
    s.step = "offer";
    saveState();
    await send(
        chat,
        `Блок пройден, спасибо! Ответов: <b>${s.answered.length}</b>.\n\nМожно посмотреть инструменты других ролей — это по желанию:`,
        counts
            .map((x) => [
                { text: `${x.r} (${x.n})`, callback_data: `more:${x.r}` },
            ])
            .concat([[{ text: "🏁 Завершить", callback_data: "more:-" }]]),
    );
}

async function finish(chat, s) {
    s.step = "done";
    saveState();
    await send(
        chat,
        `Готово! Ответов записано: <b>${s.answered.length}</b>.\n\nЭто волна ${WAVE} года — результаты появятся на landscape1c.ru после закрытия сбора.\n\nЗаметил ошибку в ответах — напиши название инструмента, поправим.`,
        [[{ text: "📋 Мои ответы", callback_data: "sum:0" }]],
    );
}

// ── Итоговый список и исправление ответов ──
// Последний ответ пользователя по каждому инструменту из журнала
const myAnswers = (chat) => {
    if (!fs.existsSync(ANSWERS)) return [];
    const my = new Map();
    fs.readFileSync(ANSWERS, "utf8")
        .split("\n")
        .filter(Boolean)
        .forEach((l) => {
            try {
                const r = JSON.parse(l);
                if (r.uid === uid(chat)) my.set(r.tool, r);
            } catch (e) {}
        });
    return [...my.values()];
};
const ANS_MARK = { работал: "✅", слышал: "👂", "не знаю": "🤷" };
const SENT_MARK = { да: " 👍", нет: " 👎" };
const CP_BTNS = [
    [
        { text: "▶️ Продолжаем", callback_data: "cont:" },
        { text: "⏸ Пауза", callback_data: "pause:" },
    ],
];
const PAGE = 40;
async function sendSummary(chat, page) {
    const rows = myAnswers(chat);
    if (!rows.length) return send(chat, "Ответов пока нет.");
    const order = { работал: 0, слышал: 1, "не знаю": 2 };
    rows.sort(
        (a, b) =>
            order[a.answer] - order[b.answer] ||
            a.tool.localeCompare(b.tool, "ru"),
    );
    const pages = Math.ceil(rows.length / PAGE);
    const p = Math.min(Math.max(page, 0), pages - 1);
    const lines = rows
        .slice(p * PAGE, p * PAGE + PAGE)
        .map(
            (r) =>
                `${ANS_MARK[r.answer]} ${esc(r.tool)}${(r.sentiment && SENT_MARK[r.sentiment]) || ""}`,
        );
    const nav = [];
    if (p > 0) nav.push({ text: "⬅️", callback_data: `sum:${p - 1}` });
    if (p < pages - 1) nav.push({ text: "➡️", callback_data: `sum:${p + 1}` });
    await send(
        chat,
        `Твои ответы${pages > 1 ? ` (стр. ${p + 1}/${pages})` : ""}:\n\n${lines.join("\n")}\n\nОшибся где-то — напиши название инструмента, исправим.`,
        nav.length ? [nav] : undefined,
    );
}
// Исправление записано — возвращаемся, откуда пришли (финал или чекпоинт)
async function fixDone(chat, s, what) {
    const back = s.fixReturn || "done";
    s.step = back;
    s.fixReturn = null;
    saveState();
    if (back === "checkpoint")
        return send(chat, `Исправлено: ${what}`, CP_BTNS);
    return send(chat, `Исправлено: ${what}`);
}
// Карточка исправления: тот же вопрос, но вне очереди опроса.
// Запоминаем, откуда пришли (финал или чекпоинт), чтобы вернуться туда же
async function sendFixCard(chat, s, name) {
    if (s.step !== "fix") s.fixReturn = s.step;
    s.step = "fix";
    s.fixTool = name;
    saveState();
    const i = byName(name);
    const text =
        `<b>${esc(i.name)}</b>  <i>(исправление)</i>\n\n` +
        esc(i.description) +
        (i.why ? `\n\n💡 ${esc(i.why)}` : "");
    const logo = logoFile(i);
    if (logo)
        await sendPhoto(chat, logo, text, EXP_BTNS).catch(() =>
            send(chat, text, EXP_BTNS),
        );
    else await send(chat, text, EXP_BTNS);
}

// ── Обработка апдейтов ──
async function startIntro(chat, keepAnswered) {
    state[chat] = {
        step: "intro",
        answered: keepAnswered || [],
        doneRoles: [],
    };
    saveState();
    await send(
        chat,
        "Привет! Это опрос от <b>Ландшафта технологий 1С</b> — landscape1c.ru\n\n" +
            "Мы собрали карту из всех инструментов экосистемы 1С и хотим проверить ее реальное состояние: что сообщество правда использует, о чем только слышало, а что знает полтора человека\n\n" +
            "Про каждый инструмент два вопроса: <b>работал или слышал о нем</b> и <b>насколько он тебе интересен</b>\n\n" +
            "Время прохождения зависит от твоей роли и уровня, но не более 30 минут. Прерваться можно в любой момент, прогресс сохранится",
        [[{ text: "🙌 Я в деле", callback_data: "go:" }]],
    );
}

const RESET_WORDS = ["/reset", "сброс", "сбросить", "заново"];
async function onMessage(m) {
    const chat = m.chat.id;
    const s = state[chat];
    const cmd = (m.text || "").trim().toLowerCase();
    // Сброс: стираем ответы и прогресс пользователя (с подтверждением)
    if (RESET_WORDS.includes(cmd) && s) {
        return send(
            chat,
            "Стереть все твои ответы и прогресс? Это необратимо — опрос начнется с чистого листа.",
            [
                [
                    { text: "🧹 Да, стереть", callback_data: "reset:yes" },
                    { text: "Отмена", callback_data: "reset:no" },
                ],
            ],
        );
    }
    if (m.text === "/start" || !s) {
        return startIntro(chat, s && s.answered);
    }
    // Любой текст посреди опроса — повторяем текущий шаг
    if (s.step === "quiz") await sendCard(chat, s);
    else if (s.step === "paused") {
        s.step = "quiz";
        saveState();
        await send(chat, "С возвращением! 👋 Продолжаем с того же места.");
        await sendCard(chat, s);
    } else if (
        s.step === "done" ||
        s.step === "fix" ||
        s.step === "checkpoint"
    ) {
        // После финиша любой текст — поиск инструмента для исправления ответа
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
        if (!cand.length)
            return send(
                chat,
                "Не нашел такого среди твоих ответов. Попробуй написать название по-другому, или /start — пройти опрос заново.",
            );
        if (cand.length === 1) return sendFixCard(chat, s, cand[0]);
        if (cand.length > 6)
            return send(chat, `Нашлось ${cand.length} — уточни название.`);
        s.fixList = cand;
        saveState();
        return send(
            chat,
            "Какой из них?",
            cand.map((n, i) => [{ text: n, callback_data: `fixpick:${i}` }]),
        );
    }
}

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
        // Стираем ответы пользователя из журнала и прогресс из состояния
        if (fs.existsSync(ANSWERS)) {
            const keep = fs
                .readFileSync(ANSWERS, "utf8")
                .split("\n")
                .filter(Boolean)
                .filter((l) => {
                    try {
                        return JSON.parse(l).uid !== uid(chat);
                    } catch (e) {
                        return true;
                    }
                });
            fs.writeFileSync(
                ANSWERS,
                keep.length ? keep.join("\n") + "\n" : "",
            );
        }
        delete state[chat];
        saveState();
        // «Все стерто» — как тост: показали и через пару секунд убрали
        const note = await send(chat, "Все стерто 🧹").catch(() => null);
        if (note) setTimeout(() => hideCard(chat, note.message_id), 3000);
        return startIntro(chat);
    }
    if (kind === "go" && s.step === "intro") {
        s.step = "role";
        saveState();
        return send(
            chat,
            "<b>Кто ты по роли?</b>\n\n" +
                "Как мы их понимаем:\n" +
                "- <b>Разработчик</b> — код и запросы, конфигурации и расширения, юнит-тесты, интеграции, автоматизация на OneScript\n" +
                "- <b>Администратор</b> (включая devops) — платформа, кластер, СУБД, бэкапы и обновления, CI-инфраструктура, мониторинг и производительность\n" +
                "- <b>Тестировщик</b> — функциональное тестирование, автотесты (Vanessa, Сценарное тестирование), прогоны в CI, баг-трекеры\n" +
                "- <b>Аналитик</b> (функциональный консультант) — требования и ТЗ, бизнес-процессы, прототипы, приемочные сценарии, настройка типовых, отчеты\n\n" +
                "Совмещаешь — выбирай ту, где проводишь больше времени\nПотом можно будет пройти и для другой роли",
            btnRows(ROLES, "role"),
        );
    }
    if (kind === "role" && s.step === "role") {
        s.role = val;
        s.step = "level";
        saveState();
        return send(
            chat,
            "<b>Какой у тебя уровень?</b>\n\n" +
                "- <b>начинающий</b> — первые год-два в 1С, осваиваешь базу\n" +
                "- <b>опытный</b> — уверенно работаешь самостоятельно\n" +
                "- <b>эксперт</b> — к тебе приходят за советом",
            btnRows(LEVELS, "level", 3),
        );
    }
    if (kind === "level" && s.step === "level") {
        s.level = val;
        s.step = "context";
        saveState();
        return send(
            chat,
            "<b>Где работаешь?</b>\n\n" +
                "- <b>франчайзи</b> и фриланс — точечные доработки по месту: пришел к клиенту, сделал расширение или отчет\n" +
                "- <b>инхаус</b> — сопровождение и постепенная доработка своей конфигурации внутри компании\n" +
                "- <b>продукты</b> — разработка тиражной конфигурации или продукта\n" +
                "- <b>проекты</b> — масштабные внедрения (например, ЕРП): обследование, миграции, интеграции",
            btnRows(CONTEXTS, "ctx"),
        );
    }
    if (kind === "ctx" && s.step === "context") {
        s.context = val;
        s.block = s.role;
        s.queue = buildQueue(s.block, s.answered);
        s.pos = 0;
        s.step = "quiz";
        saveState();
        await send(
            chat,
            `Поехали: инструменты роли «${s.role}» — ${s.queue.length} шт. Сначала базовые, дальше интереснее.`,
        );
        return sendCard(chat, s);
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
            if (isFix) return fixDone(chat, s, `${esc(tool)} — не знаю 🤷`);
            return next(chat, s);
        }
        s.pending = { tool, answer: val, fix: isFix };
        saveState();
        return api("editMessageReplyMarkup", {
            chat_id: chat,
            message_id: q.message.message_id,
            reply_markup: { inline_keyboard: SENT[val] },
        }).catch(() =>
            send(
                chat,
                val === "работал"
                    ? "Использовал бы снова?"
                    : "Хочешь попробовать?",
                SENT[val],
            ),
        );
    }
    if (kind === "s" && s.pending) {
        const { tool, answer, fix } = s.pending;
        record(s, chat, tool, answer, val === "-" ? null : val);
        s.pending = null;
        hideCard(chat, q.message.message_id);
        if (fix) return fixDone(chat, s, `${esc(tool)} ✍️`);
        return next(chat, s);
    }
    if (kind === "sum") return sendSummary(chat, +val || 0);
    if (kind === "fixpick" && s.fixList && s.fixList[+val]) {
        const name = s.fixList[+val];
        s.fixList = null;
        return sendFixCard(chat, s, name);
    }
    if (kind === "cont" && s.step === "checkpoint") {
        s.step = "quiz";
        saveState();
        return sendCard(chat, s);
    }
    if (kind === "pause" && s.step === "checkpoint") {
        s.step = "paused";
        saveState();
        return send(
            chat,
            "Прогресс сохранен 👌\n\nВозвращайся, когда удобно: просто напиши боту что-нибудь — продолжим с того же места.",
        );
    }
    if (kind === "more" && s.step === "offer") {
        if (val === "-") return finish(chat, s);
        s.block = val;
        s.queue = buildQueue(val, s.answered);
        s.pos = 0;
        s.step = "quiz";
        saveState();
        return sendCard(chat, s);
    }
}

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
    // Последняя десятка — для сводки на чекпоинте
    s.recent = s.recent || [];
    s.recent.push({ tool, answer, sentiment });
    if (s.recent.length > 10) s.recent.shift();
}
// Поощрялки каждые 10 ответов; чем ближе конец блока, тем радостнее.
// Без повторов, пока пул уровня не исчерпан (s.cheered — уже показанные)
const CHEERS = [
    [
        "Десяточка! Так держать 🙌",
        "Отлично идем! 💪",
        "Красота, продолжаем 🚀",
        "Каждый ответ делает карту точнее. Спасибо! 🗺",
        "Ровным ходом — дальше интереснее 😉",
        "Разогрелись! Впереди самое любопытное 🔧",
        "Плюс десять к карме сообщества ✨",
        "Идешь как по регламентному заданию — стабильно 🕐",
        "Хороший темп! Кофе можно не отставлять ☕",
        "Уже виден твой вклад в карту 📍",
        "Отвечается легко? Значит, роль выбрана верно 🎯",
        "Первые десятки — самые важные. Погнали дальше!",
    ],
    [
        "Больше половины позади! 🔥",
        "Экватор пройден, полет нормальный ✈️",
        "Сообщество тебе уже благодарно 🙏",
        "Серьезная заявка! Продолжаем 💥",
        "Ты в потоке — не останавливайся 🌊",
        "Такими темпами и до эксперта совета недалеко 🎓",
        "Уверенно, как проведение документа без ошибок ✅",
        "Половина ландшафта уже знает твое мнение 🗣",
        "Продолжаем — статистика любит настойчивых 📊",
        "Отличная выдержка! Дальше пойдут нишевые — самое интересное 🔍",
        "Ты явно видел жизнь. И инструменты 😎",
        "Середина позади, дальше легче — проверено 🧭",
    ],
    [
        "Еще чуть-чуть! 🏁",
        "Финишная прямая! 🎉",
        "Осталось всего ничего — держись! ⚡",
        "Почти все, ты герой 🦸",
        "Последний рывок — и блок твой! 🏆",
        "Финал близко — не сворачивай 🧗",
        "Осталась горстка карточек — дожми! 💎",
        "Такое прохождение — хоть в отчет о тестировании 📄",
        "Ты почти закрыл блок целиком. Это редкость! 🌟",
        "Виден финиш! Сообщество аплодирует 👏",
        "Дожимай — и в зале славы ландшафта 🏛",
        "Пара нажатий — и полный комплект 🧩",
    ],
];
async function next(chat, s) {
    s.pos++;
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
        const recent = (s.recent || [])
            .map(
                (r) =>
                    `${ANS_MARK[r.answer]} ${esc(r.tool)}${(r.sentiment && SENT_MARK[r.sentiment]) || ""}`,
            )
            .join("\n");
        s.recent = [];
        saveState();
        return send(
            chat,
            `Пройдено <b>${s.pos}</b> из ${s.queue.length} — вот как ты ответил. Спасибо!\n\n${recent}\n\n${cheer}\n\nОшибся в чем-то — напиши название инструмента, поправим. Или двигаемся дальше!`,
            CP_BTNS,
        );
    }
    await sendCard(chat, s);
}

// ── Long polling ──
(async () => {
    console.log(`Бот запущен. Волна ${WAVE}. Инструментов: ${L.items.length}.`);
    let offset = 0;
    for (;;) {
        try {
            const updates = await api("getUpdates", { offset, timeout: 50 });
            for (const u of updates) {
                offset = u.update_id + 1;
                if (u.message) await onMessage(u.message).catch(console.error);
                if (u.callback_query)
                    await onCallback(u.callback_query).catch(console.error);
            }
        } catch (e) {
            console.error("poll:", e.message);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
})();
