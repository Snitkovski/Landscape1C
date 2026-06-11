// Cache-bust для GitHub Pages (деплоится app/ как есть).
// Проставляет ?v=<хеш> у всех локальных ассетов (css/js) во ВСЕХ app/*.html
// по содержимому файла. Заменяет ручной бамп ?v= на каждой странице:
// поправил файл → запустил `node scripts/cachebust.js` → версии обновились
// только у изменившихся ассетов, сразу на всех страницах.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const APP = path.join(__dirname, "..", "app");

const hashes = {};
function hashOf(asset) {
    if (asset in hashes) return hashes[asset];
    try {
        const buf = fs.readFileSync(path.join(APP, asset));
        return (hashes[asset] = crypto
            .createHash("md5")
            .update(buf)
            .digest("hex")
            .slice(0, 8));
    } catch (e) {
        return (hashes[asset] = null); // внешний/несуществующий — не трогаем
    }
}

// href/src="<имя-без-слешей>?v=...": только локальные ассеты, не внешние URL
const RE = /\b(href|src)="([A-Za-z0-9_.\-]+)\?v=[^"]*"/g;
const htmls = fs.readdirSync(APP).filter((f) => f.endsWith(".html"));
let changed = 0;
const touched = new Set();
for (const html of htmls) {
    const p = path.join(APP, html);
    const src = fs.readFileSync(p, "utf8");
    const out = src.replace(RE, (m, attr, asset) => {
        const h = hashOf(asset);
        if (!h) return m;
        const next = `${attr}="${asset}?v=${h}"`;
        if (next !== m) touched.add(asset);
        return next;
    });
    if (out !== src) {
        fs.writeFileSync(p, out);
        changed++;
    }
}
console.log(
    `cachebust: обновлено ${changed} из ${htmls.length} html` +
        (touched.size ? `; ассеты: ${[...touched].sort().join(", ")}` : " (всё актуально)"),
);
