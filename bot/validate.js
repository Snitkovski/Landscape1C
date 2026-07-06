// Самопроверка бота (без телеграма и токена): node bot/validate.js
// Гоняется перед запуском волны и после правок данных/текстов.
"use strict";
const fs = require("fs");
const path = require("path");
const {
    L,
    ROLES,
    badExcluded,
    badTestSet,
    TEST_MODE,
    buildQueue,
    EXCLUDED,
} = require("./lib/quiz");
const { logoFile } = require("./lib/logos");

let errors = 0;
const err = (m) => {
    console.error("✗ " + m);
    errors++;
};

// Исключения сверяются с data.js — опечатка тихо выкинет инструмент из опроса
badExcluded().forEach((n) => err(`excluded.json: «${n}» не найден в data.js`));

// Фиксированный тестовый набор тоже сверяем всегда — опечатка выкинет
// инструмент из тестовой колоды (name должен совпадать с data.js)
badTestSet().forEach((n) => err(`test-set.json: «${n}» не найден в data.js`));

// У каждой роли должна собираться непустая очередь
const kind = TEST_MODE ? "тестовый набор" : "с вкраплениями нишевых";
ROLES.forEach((role) => {
    const q = buildQueue(role, []);
    if (!q.length) err(`пустая очередь у роли «${role}»`);
    else console.log(`✓ ${role}: очередь ${q.length} (${kind})`);
});

// Буква «ё» в текстах бота запрещена — как во всем интерфейсе ландшафта
// (комментарии в коде не считаются — правило про то, что видит пользователь)
["bot.js", "lib/texts.js"].forEach((f) => {
    const src = fs
        .readFileSync(path.join(__dirname, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
    if (/[ёЁ]/.test(src)) err(`буква «ё» в ${f}`);
});

// Логотипы: у SVG должен быть пререндеренный PNG (bot/render-logos.js)
const noLogo = L.items.filter((i) => i.logo && !logoFile(i));
if (noLogo.length)
    console.warn(
        `⚠ без готового логотипа (карточка уйдет текстом): ${noLogo
            .map((i) => i.name)
            .join(", ")}`,
    );

console.log(
    errors
        ? `Ошибок: ${errors}`
        : `OK. Инструментов: ${L.items.length}, исключено: ${EXCLUDED.length}.`,
);
process.exit(errors ? 1 : 0);
