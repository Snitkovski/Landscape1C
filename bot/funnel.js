// Здоровье волны для мониторинга сбора: node bot/funnel.js [путь к answers.jsonl]
// Не про инструменты (это report.js), а про респондентов: кто пришел,
// докуда дошел, где бросил, с каким темпом — чтобы вовремя заметить
// перекос по ролям или проблему UX.
"use strict";
const fs = require("fs");
const path = require("path");
const { buildQueue } = require("./lib/quiz");

const FILE = process.argv[2] || path.join(__dirname, "answers.jsonl");
if (!fs.existsSync(FILE)) {
    console.error(`Не найден журнал ответов: ${FILE}`);
    process.exit(1);
}
const rows = fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// Респонденты: профиль из последней записи, ответы в хронологии
const users = new Map();
rows.forEach((r) => {
    const u = users.get(r.uid) || { rows: [] };
    u.rows.push(r);
    u.role = r.role;
    u.level = r.level;
    u.context = r.context;
    users.set(r.uid, u);
});

const tally = (arr, key) => {
    const m = new Map();
    arr.forEach((x) => m.set(key(x), (m.get(key(x)) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const line = (pairs, total) =>
    pairs
        .map(([k, n]) => `${k} ${n} (${Math.round((100 * n) / total)}%)`)
        .join(", ");
const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};

const all = [...users.values()];
console.log(`Респондентов: ${all.length}, записей в журнале: ${rows.length}`);
console.log(
    `  по ролям:      ${line(
        tally(all, (u) => u.role),
        all.length,
    )}`,
);
console.log(
    `  по уровням:    ${line(
        tally(all, (u) => u.level),
        all.length,
    )}`,
);
console.log(
    `  по контекстам: ${line(
        tally(all, (u) => u.context),
        all.length,
    )}`,
);

// Активность по дням: новые респонденты и ответы
console.log("\nПо дням (новые респонденты / ответов):");
const firstDay = new Map();
for (const [uid, u] of users) firstDay.set(uid, u.rows[0].ts.slice(0, 10));
const days = new Map();
rows.forEach((r) => {
    const d = days.get(r.ts.slice(0, 10)) || { fresh: 0, answers: 0 };
    d.answers++;
    days.set(r.ts.slice(0, 10), d);
});
for (const d of firstDay.values()) days.get(d).fresh++;
[...days.entries()]
    .sort()
    .forEach(([d, x]) => console.log(`  ${d}: +${x.fresh} / ${x.answers}`));

// Воронка ядра: докуда дошли в блоке своей роли.
// Размер личной очереди не пишется в журнал — сравниваем с эталонной
// очередью роли (для первой роли респондента это она и есть)
console.log("\nВоронка ядра (ответов в блоке своей роли / размер очереди):");
const qlen = {};
const buckets = new Map([
    ["0-24%", 0],
    ["25-49%", 0],
    ["50-74%", 0],
    ["75-99%", 0],
    ["100%", 0],
]);
all.forEach((u) => {
    qlen[u.role] = qlen[u.role] || buildQueue(u.role, []).length;
    const core = u.rows.filter((r) => r.block === u.role).length;
    const p = Math.min(core / qlen[u.role], 1);
    const b =
        p >= 1
            ? "100%"
            : p >= 0.75
              ? "75-99%"
              : p >= 0.5
                ? "50-74%"
                : p >= 0.25
                  ? "25-49%"
                  : "0-24%";
    buckets.set(b, buckets.get(b) + 1);
});
for (const [b, n] of buckets) console.log(`  ${b.padStart(6)}: ${n}`);
const beyond = all.filter((u) => u.rows.some((r) => r.block !== u.role)).length;
console.log(`  пошли дальше ядра (чужая роль или редкие): ${beyond}`);

// Темп: медиана секунд на ответ (дельты подряд внутри респондента,
// паузы длиннее 10 минут не считаются)
const deltas = [];
all.forEach((u) => {
    for (let i = 1; i < u.rows.length; i++) {
        const d =
            (Date.parse(u.rows[i].ts) - Date.parse(u.rows[i - 1].ts)) / 1000;
        if (d > 0 && d < 600) deltas.push(d);
    }
});
console.log(`\nТемп: медиана ${median(deltas)} сек на ответ`);

// Второй вопрос: как часто отвечают, а не жмут «Дальше»
const withSent = rows.filter((r) => r.answer !== "не знаю");
const skipped = withSent.filter((r) => !r.sentiment).length;
console.log(
    `Второй вопрос: пропускают ${Math.round((100 * skipped) / withSent.length)}% (${skipped} из ${withSent.length})`,
);

// Распределение ответов
console.log(
    `Ответы: ${line(
        tally(rows, (r) => r.answer),
        rows.length,
    )}`,
);
