// Валидатор данных ландшафта. Запуск: node scripts/validate.js
// Ловит дрейф между app/data.js и инвариантами движка (см. CLAUDE.md).
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "app");
global.window = {};
require(path.join(APP, "data.js"));
const D = global.window.LANDSCAPE;

const errors = [];
const E = (msg) => errors.push(msg);

// 1. Значения осей у карточек должны быть из axes.<ось>.values
const scalarAxes = { maturity: "maturity", origin: "origin", license: "license", availability: "availability" };
const arrayAxes = { role: "roles", context: "contexts" };
D.items.forEach((i) => {
  for (const [axis, field] of Object.entries(scalarAxes)) {
    if (i[field] != null && !D.axes[axis].values.includes(i[field]))
      E(`«${i.name}»: ${field}="${i[field]}" нет в axes.${axis}`);
  }
  for (const [axis, field] of Object.entries(arrayAxes)) {
    (i[field] || []).forEach((v) => {
      if (!D.axes[axis].values.includes(v)) E(`«${i.name}»: ${field} содержит "${v}", которого нет в axes.${axis}`);
    });
  }
});

// 2. Категории и блоки: каждая категория ровно в одном блоке
const cats = new Set(D.categories);
D.items.forEach((i) => {
  if (!cats.has(i.category)) E(`«${i.name}»: категория "${i.category}" отсутствует в categories`);
});
if (D.blocks) {
  const inBlocks = D.blocks.flatMap((b) => b.categories);
  inBlocks.forEach((c) => {
    if (!cats.has(c)) E(`блок ссылается на несуществующую категорию "${c}"`);
  });
  D.categories.forEach((c) => {
    const n = inBlocks.filter((x) => x === c).length;
    if (n === 0) E(`категория "${c}" не входит ни в один блок`);
    if (n > 1) E(`категория "${c}" входит в блоки ${n} раз(а)`);
  });
}

// 3. Файлы логотипов существуют
D.items.forEach((i) => {
  if (i.logo && !fs.existsSync(path.join(APP, "logos", i.logo))) E(`«${i.name}»: нет файла logos/${i.logo}`);
});

// 4. Связи analogs/depends резолвятся в существующие карточки
const names = new Set(D.items.map((i) => i.name));
D.items.forEach((i) => {
  ["analogs", "depends"].forEach((rel) =>
    (i[rel] || []).forEach((n) => {
      if (!names.has(n)) E(`«${i.name}»: ${rel} ссылается на несуществующий "${n}"`);
    })
  );
});

// 5. Буква «ё» в видимом тексте (в интерфейсе её не используем)
const yo = (s) => typeof s === "string" && /[ёЁ]/.test(s);
D.items.forEach((i) => {
  ["name", "description", "why", "category", "subcategory"].forEach((f) => {
    if (yo(i[f])) E(`«${i.name}»: буква «ё» в поле ${f}`);
  });
});
D.categories.forEach((c) => {
  if (yo(c)) E(`буква «ё» в категории "${c}"`);
});
Object.entries(D.axes).forEach(([a, ax]) => {
  if (yo(ax.label)) E(`буква «ё» в метке оси ${a}`);
  ax.values.forEach((v) => {
    if (yo(v)) E(`буква «ё» в значении оси ${a}: "${v}"`);
  });
});

if (errors.length) {
  console.error(`✗ Найдено проблем: ${errors.length}`);
  errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}
console.log(
  `✓ Данные валидны: ${D.items.length} карточек, ${D.categories.length} категорий, ${D.blocks ? D.blocks.length : 0} блоков`
);
