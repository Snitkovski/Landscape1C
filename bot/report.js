// Сводка по собранным ответам бота: node bot/report.js [роль]
// Метрики как у State of JS: узнаваемость, использование, retention, интерес.
"use strict";
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "answers.jsonl");
if (!fs.existsSync(FILE)) {
    console.log("Ответов пока нет (bot/answers.jsonl не найден).");
    process.exit(0);
}
const roleFilter = process.argv[2]; // необязательный срез по роли респондента
const rows = fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => !roleFilter || r.role === roleFilter);

// На респондента и инструмент берем последний ответ (перепрохождения не дублируют)
const last = new Map();
rows.forEach((r) => last.set(`${r.uid}|${r.tool}`, r));

const stats = new Map(); // tool → счетчики
for (const r of last.values()) {
    const t = stats.get(r.tool) || {
        used: 0,
        heard: 0,
        unknown: 0,
        again: 0,
        notAgain: 0,
        want: 0,
        notWant: 0,
        total: 0,
    };
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
    stats.set(r.tool, t);
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");
const respondents = new Set(rows.map((r) => r.uid)).size;
console.log(
    `Респондентов: ${respondents}, ответов: ${last.size}` +
        (roleFilter ? ` (срез: ${roleFilter})` : ""),
);
console.log(
    "\nинструмент | ответов | узнаваемость | использование | retention | интерес",
);
// Retention и интерес — только от ответивших на второй вопрос:
// пропуск («Дальше») не считается за «нет»
[...stats.entries()]
    .sort((a, b) => b[1].used - a[1].used)
    .forEach(([tool, t]) => {
        console.log(
            `${tool} | ${t.total} | ${pct(t.used + t.heard, t.total)} | ${pct(t.used, t.total)} | ${pct(t.again, t.again + t.notAgain)} | ${pct(t.want, t.want + t.notWant)}`,
        );
    });
