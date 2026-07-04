// Логика опроса: данные ландшафта, исключения и построение очередей.
// Чистые функции без телеграма — их гоняет и bot/validate.js.
"use strict";
const fs = require("fs");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "..", "app", "data.js"));
const L = global.window.LANDSCAPE;
const ROLES = L.axes.role.values; // разработчик / администратор / тестировщик / аналитик
const CONTEXTS = L.axes.context.values; // франчайзи / инхаус / продукты / проекты
const LEVELS = ["начинающий", "опытный", "эксперт"];

// Исключения из опроса (bot/excluded.json): универсальные инструменты,
// про которые спрашивать глупо — в итогах пойдут как «не применимо»
let EXCLUDED = [];
try {
    EXCLUDED =
        JSON.parse(
            fs.readFileSync(
                path.join(__dirname, "..", "excluded.json"),
                "utf8",
            ),
        ).excluded || [];
} catch (e) {}
// Имена исключений, которых нет в data.js (опечатки) — для проверки при старте
const badExcluded = () =>
    EXCLUDED.filter((n) => !L.items.some((i) => i.name === n));

const byName = (n) => L.items.find((i) => i.name === n);

// Что вообще спрашиваем: без исключений (excluded.json) и без сертификаций —
// сертификация не инструмент, в опросе популярности ей не место
const askable = (i) =>
    !EXCLUDED.includes(i.name) && i.category !== "Сертификация";

const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};
const pick = (role, answered, maturity) =>
    shuffle(
        L.items.filter(
            (i) =>
                (i.roles || []).includes(role) &&
                i.maturity === maturity &&
                !answered.includes(i.name) &&
                askable(i),
        ),
    ).map((i) => i.name);

// Очередь роли: ядро из продвинутых (базовые у всех по определению —
// в итогах пойдут как «не применимо», как и excluded.json) с вкраплениями
// нишевых — по одному на тройку продвинутых, чтобы стена незнакомого
// не копилась в конце. Пользователю это деление не показываем — для него
// это просто инструменты. Порядок случайный — без позиционного смещения
const buildQueue = (role, answered) => {
    const niche = pick(role, answered, "нишевое");
    const q = [];
    pick(role, answered, "продвинутое").forEach((name, idx) => {
        q.push(name);
        if ((idx + 1) % 3 === 0 && niche.length) q.push(niche.shift());
    });
    return q;
};
// Нишевые, не попавшие в ядро: по ролям, которые респондент уже проходил
const nichePool = (s) =>
    shuffle(
        L.items.filter(
            (i) =>
                i.maturity === "нишевое" &&
                !s.answered.includes(i.name) &&
                askable(i) &&
                (i.roles || []).some((r) => s.doneRoles.includes(r)),
        ),
    ).map((i) => i.name);

// Три «не знаю» подряд — поднимаем ближайший массовый (продвинутый)
// инструмент, чтобы не добивать серией незнакомых нишевых
const promoteMainstream = (s) => {
    if (s.streak >= 3 && s.pos < s.queue.length) {
        const j = s.queue.findIndex(
            (n, i) =>
                i >= s.pos && (byName(n) || {}).maturity === "продвинутое",
        );
        if (j > s.pos) s.queue.splice(s.pos, 0, s.queue.splice(j, 1)[0]);
    }
};

module.exports = {
    L,
    ROLES,
    CONTEXTS,
    LEVELS,
    EXCLUDED,
    badExcluded,
    byName,
    buildQueue,
    nichePool,
    promoteMainstream,
};
