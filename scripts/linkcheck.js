// Проверка внешних ссылок карточек (homepage, repo, start[].url) на живость.
// Ручной запуск время от времени: node scripts/linkcheck.js — в CI не гоняем
// (сеть нестабильна, часть сайтов режет ботов; результат — повод проверить руками).
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "app", "data.js"));
const D = global.window.LANDSCAPE;

const TIMEOUT = 15000;
const PARALLEL = 8;

// url → карточки, где встречается
const urls = new Map();
const add = (url, card) => {
  if (!url) return;
  if (!urls.has(url)) urls.set(url, []);
  urls.get(url).push(card);
};
D.items.forEach((i) => {
  add(i.homepage, i.name);
  add(i.repo, i.name);
  (i.start || []).forEach((s) => add(s.url, i.name));
});

async function check(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "Mozilla/5.0 (linkcheck landscape1c.ru)" },
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return e.name === "TimeoutError" ? "таймаут" : e.cause?.code || e.message;
  }
}

(async () => {
  const list = [...urls.keys()];
  console.log(`Проверяю ${list.length} уникальных ссылок из ${D.items.length} карточек…`);
  const broken = [];
  for (let i = 0; i < list.length; i += PARALLEL) {
    const batch = list.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(check));
    batch.forEach((url, k) => {
      if (results[k]) broken.push([url, results[k]]);
    });
    process.stdout.write(`\r  ${Math.min(i + PARALLEL, list.length)} из ${list.length}`);
  }
  console.log("");
  if (!broken.length) {
    console.log("✓ Все ссылки отвечают");
    return;
  }
  console.log(`✗ Подозрительных: ${broken.length} (боты часто получают 403 — проверьте руками)`);
  broken.forEach(([url, why]) => {
    console.log(`  - ${url} — ${why} (${urls.get(url).join(", ")})`);
  });
})();
