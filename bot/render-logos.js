// Пререндер SVG-логотипов в PNG для телеграма (SVG он не принимает).
// Гоняется вручную на macOS (qlmanage из QuickLook), результат коммитится
// в bot/logos-png/ — сам бот ничего не рендерит и запускается на любой ОС.
// Прогонять после добавления новых логотипов в app/logos/:
//   node bot/render-logos.js         # только недостающие
//   node bot/render-logos.js --all   # перерендерить все заново
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { L } = require("./lib/quiz");
const { LOGOS, PNG } = require("./lib/logos");

if (process.platform !== "darwin") {
    console.error("Рендер работает только на macOS (qlmanage).");
    process.exit(1);
}
fs.mkdirSync(PNG, { recursive: true });
const all = process.argv.includes("--all");

// SVG без viewBox QuickLook рисует мелко в углу холста 512: подставляем
// viewBox из width/height и раздуваем сами width/height до 512 (маленькие
// интринсик-размеры QuickLook не апскейлит) — рендерим правленую копию
const TMP = path.join(PNG, "_src");
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
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, f), patched);
    return path.join(TMP, f);
};

const svgLogos = [...new Set(L.items.map((i) => i.logo).filter(Boolean))]
    .filter((f) => /\.svg$/i.test(f))
    .filter((f) => fs.existsSync(path.join(LOGOS, f)));
const todo = svgLogos.filter(
    (f) => all || !fs.existsSync(path.join(PNG, f + ".png")),
);
if (todo.length) {
    execFileSync(
        "qlmanage",
        ["-t", "-s", "512", "-o", PNG, ...todo.map(svgSrc)],
        {
            stdio: "ignore",
        },
    );
    fs.rmSync(TMP, { recursive: true, force: true });
}

const missing = svgLogos.filter(
    (f) => !fs.existsSync(path.join(PNG, f + ".png")),
);
console.log(
    `SVG-логотипов: ${svgLogos.length}, отрендерено сейчас: ${todo.length - missing.length}, всего PNG готово: ${svgLogos.length - missing.length}.`,
);
if (missing.length) {
    console.error(`⚠ Не удалось отрендерить: ${missing.join(", ")}`);
    process.exit(1);
}
