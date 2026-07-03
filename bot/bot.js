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
            [
                "-t",
                "-s",
                "512",
                "-o",
                CACHE,
                ...svgs.map((f) => path.join(LOGOS, f)),
            ],
            {
                stdio: "ignore",
            },
        );
    } catch (e) {
        console.error("рендер логотипов:", e.message);
    }
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
// sendPhoto с загрузкой файла — multipart руками (зависимостей нет)
const sendPhoto = (chat, file, caption, keyboard) =>
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
        { text: "🤷 Не знаю", callback_data: "a:не знаю" },
    ],
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
        `Готово! Ответов записано: <b>${s.answered.length}</b>.\n\nЭто волна ${WAVE} года — результаты появятся на landscape1c.ru после закрытия сбора. Вернуться и продолжить можно в любой момент: /start`,
    );
}

// ── Обработка апдейтов ──
async function onMessage(m) {
    const chat = m.chat.id;
    const s = state[chat];
    if (m.text === "/start" || !s) {
        state[chat] = {
            step: "intro",
            answered: (s && s.answered) || [],
            doneRoles: [],
        };
        saveState();
        await send(
            chat,
            `Привет! Это опрос от <b>Ландшафта технологий 1С</b> — landscape1c.ru.\n\nМы собрали карту из ${L.items.length} инструментов экосистемы 1С и хотим проверить ее реальное состояние: что сообщество правда использует, о чем только слышало, а что знает полтора человека.\n\nПро каждый инструмент один вопрос: <b>работал / слышал / не знаю</b>. Займет сколько захочешь — прерваться можно в любой момент, прогресс сохранится.`,
            [[{ text: "🙌 Я в деле", callback_data: "go:" }]],
        );
        return;
    }
    // Любой текст посреди опроса — повторяем текущий шаг
    if (s.step === "quiz") await sendCard(chat, s);
    else if (s.step === "done")
        await send(
            chat,
            "Опрос пройден. Начать заново или продолжить другими ролями: /start",
        );
}

async function onCallback(q) {
    const chat = q.message.chat.id;
    const s = state[chat];
    await api("answerCallbackQuery", { callback_query_id: q.id }).catch(
        () => {},
    );
    if (!s) return;
    const [kind, val] = q.data.split(/:(.*)/);

    if (kind === "go" && s.step === "intro") {
        s.step = "role";
        saveState();
        return send(
            chat,
            "Кто ты по роли? Как мы их понимаем (из методологии ландшафта):\n\n" +
                "👨‍💻 <b>Разработчик</b> — код и запросы, конфигурации и расширения, юнит-тесты, интеграции, автоматизация на OneScript.\n\n" +
                "🛠 <b>Администратор</b> (включая devops) — платформа, кластер, СУБД, бэкапы и обновления, CI-инфраструктура, мониторинг и производительность.\n\n" +
                "🐞 <b>Тестировщик</b> — функциональное тестирование, автотесты (Vanessa, Сценарное тестирование), прогоны в CI, баг-трекеры.\n\n" +
                "📋 <b>Аналитик</b> (функциональный консультант) — требования и ТЗ, бизнес-процессы, прототипы, приемочные сценарии, настройка типовых, отчеты.\n\n" +
                "Совмещаешь — выбирай ту, где проводишь больше времени.",
            btnRows(ROLES, "role"),
        );
    }
    if (kind === "role" && s.step === "role") {
        s.role = val;
        s.step = "level";
        saveState();
        return send(
            chat,
            "Какой у тебя уровень?\n\n" +
                "— <b>начинающий</b> — первые год-два в 1С, осваиваешь базу\n" +
                "— <b>опытный</b> — уверенно работаешь самостоятельно\n" +
                "— <b>эксперт</b> — к тебе приходят за советом",
            btnRows(LEVELS, "level", 3),
        );
    }
    if (kind === "level" && s.step === "level") {
        s.level = val;
        s.step = "context";
        saveState();
        return send(
            chat,
            "Где работаешь? Что мы понимаем под контекстами:\n\n" +
                "🏪 <b>франчайзи</b> (и фриланс) — точечные доработки по месту: пришел к клиенту, сделал расширение или отчет.\n\n" +
                "🏢 <b>инхаус</b> — сопровождение и постепенная доработка своей конфигурации внутри компании.\n\n" +
                "📦 <b>продукты</b> — разработка тиражной конфигурации или продукта.\n\n" +
                "🏗 <b>проекты</b> — масштабные внедрения (например, ЕРП): обследование, миграции, интеграции.",
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
    if (kind === "a" && s.step === "quiz") {
        // Висящий сентимент прошлой карточки — дозаписываем без него
        if (s.pending) {
            record(s, chat, s.pending.tool, s.pending.answer, null);
            s.pending = null;
        }
        const tool = s.queue[s.pos];
        if (val === "не знаю") {
            record(s, chat, tool, val, null);
            await hideCard(chat, q.message.message_id);
            return next(chat, s);
        }
        s.pending = { tool, answer: val };
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
        record(
            s,
            chat,
            s.pending.tool,
            s.pending.answer,
            val === "-" ? null : val,
        );
        s.pending = null;
        await hideCard(chat, q.message.message_id);
        return next(chat, s);
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
    s.answered.push(tool);
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
    if (s.pos % 10 === 0 && s.pos < s.queue.length) {
        const p = s.pos / s.queue.length;
        const tier = CHEERS[p < 0.4 ? 0 : p < 0.75 ? 1 : 2];
        s.cheered = s.cheered || [];
        let pool = tier.filter((c) => !s.cheered.includes(c));
        if (!pool.length) pool = tier; // пул исчерпан — идем по второму кругу
        const cheer = pool[Math.floor(Math.random() * pool.length)];
        s.cheered.push(cheer);
        saveState();
        await send(chat, cheer);
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
