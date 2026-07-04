// Агрегация ответов опроса в статические данные для витрины:
//   node bot/aggregate.js [путь к answers.jsonl]  →  bot/survey2026.js
// Формат вывода — window.SURVEY (тот же паттерн, что app/data.js: подключается
// тегом <script>, работает через file://). Смотреть — bot/results.html.
// Никакой персоналки в выводе нет: только агрегаты по инструментам и срезам.
"use strict";
const fs = require("fs");
const path = require("path");
const { byName } = require("./lib/quiz");

const FILE = process.argv[2] || path.join(__dirname, "answers.jsonl");
const OUT = path.join(__dirname, "survey2026.js");
if (!fs.existsSync(FILE)) {
    console.error(`Не найден журнал ответов: ${FILE}`);
    process.exit(1);
}
const rows = fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// Последний ответ респондента по инструменту побеждает (как в report.js);
// профиль респондента — из его последней записи (переонбординг меняет роль)
const last = new Map();
const profile = new Map();
rows.forEach((r) => {
    last.set(`${r.uid}|${r.tool}`, r);
    profile.set(r.uid, r);
});

const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const byRole = new Map();
const byLevel = new Map();
const byContext = new Map();
for (const p of profile.values()) {
    count(byRole, p.role);
    count(byLevel, p.level);
    count(byContext, p.context);
}

// Счетчики инструмента: общий и в разрезе роли респондента
const blank = () => ({
    total: 0,
    used: 0,
    heard: 0,
    unknown: 0,
    again: 0,
    notAgain: 0,
    want: 0,
    notWant: 0,
});
const add = (t, r) => {
    t.total++;
    if (r.answer === "работал") {
        t.used++;
        if (r.sentiment === "да") t.again++;
        if (r.sentiment === "нет") t.notAgain++;
    } else if (r.answer === "слышал") {
        t.heard++;
        if (r.sentiment === "да") t.want++;
        if (r.sentiment === "нет") t.notWant++;
    } else t.unknown++;
};
// Срезы инструмента: по роли, контексту и уровню респондента —
// в том числе для среза «франчайзи vs инхаус» из плана публикации
const tools = new Map();
for (const r of last.values()) {
    const t = tools.get(r.tool) || {
        all: blank(),
        byRole: {},
        byContext: {},
        byLevel: {},
    };
    add(t.all, r);
    add((t.byRole[r.role] = t.byRole[r.role] || blank()), r);
    add((t.byContext[r.context] = t.byContext[r.context] || blank()), r);
    add((t.byLevel[r.level] = t.byLevel[r.level] || blank()), r);
    tools.set(r.tool, t);
}

const out = {
    wave: rows[0] ? rows[0].wave : null,
    generated: new Date().toISOString(),
    respondents: {
        total: profile.size,
        byRole: Object.fromEntries(byRole),
        byLevel: Object.fromEntries(byLevel),
        byContext: Object.fromEntries(byContext),
    },
    tools: [...tools.entries()]
        .map(([name, t]) => {
            const i = byName(name) || {};
            return {
                name,
                category: i.category || null,
                maturity: i.maturity || null,
                ...t.all,
                byRole: t.byRole,
                byContext: t.byContext,
                byLevel: t.byLevel,
            };
        })
        .sort((a, b) => b.used - a.used || b.total - a.total),
};

fs.writeFileSync(
    OUT,
    "// Сгенерировано bot/aggregate.js — не править руками\n" +
        `window.SURVEY = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(
    `${OUT}: респондентов ${out.respondents.total}, инструментов ${out.tools.length}, уникальных ответов ${last.size}`,
);
