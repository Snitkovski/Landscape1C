(() => {
  const D = window.LANDSCAPE;
  const $ = s => document.querySelector(s);

  // Оси разметки: multi — массив значений, single — одно значение.
  const AXES = [
    { key: "role",     field: "roles",    multi: true },
    { key: "context",  field: "contexts", multi: true },
    { key: "maturity", field: "maturity", multi: false },
    { key: "origin",   field: "origin",   multi: false },
    { key: "license",  field: "license",  multi: false },
  ];

  const escH = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const wbr = s => escH(s).replace(/([.:/])/g, "$1<wbr>");   // точки переноса в длинных именах
  const escA = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── Запись прямо в файл (File System Access API) ──
  let fileHandle = null;
  function markDirty() {
    const el = $("#saved");
    if (el) { el.textContent = "● не сохранено"; el.classList.add("dirty"); }
  }
  function markSaved(msg) {
    const el = $("#saved");
    if (el) { el.textContent = msg || ("✓ сохранено · " + new Date().toLocaleTimeString("ru-RU")); el.classList.remove("dirty"); }
  }
  const save = markDirty;   // правки помечают «не сохранено»; запись — по кнопке «Сохранить»

  function loadFromText(t) {
    const obj = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    D.categories = obj.categories; D.axes = obj.axes;
    D.items = obj.items.map(it => ({ umbrella: false, ...it }));
    normalize();
    query = ""; const s = $("#search"); if (s) s.value = "";
    render();
  }
  async function openFile() {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: "data.js", accept: { "text/javascript": [".js", ".json"] } }],
      });
      fileHandle = h;
      loadFromText(await (await h.getFile()).text());
      markSaved("открыт " + h.name);
      toast("Открыт " + h.name + " — «Сохранить» пишет прямо в него");
    } catch { /* отменили выбор файла */ }
  }
  async function saveFile() {
    if (!window.showSaveFilePicker) return downloadData();   // браузер без FS API — скачиваем копию
    try {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: "data.js",
          types: [{ description: "data.js", accept: { "text/javascript": [".js"] } }],
        });
      }
      const w = await fileHandle.createWritable();
      await w.write(dataJS());
      await w.close();
      markSaved("✓ сохранено в " + fileHandle.name + " · " + new Date().toLocaleTimeString("ru-RU"));
      toast("Сохранено в " + fileHandle.name);
    } catch (e) { toast("Не сохранено: " + (e.message || e)); }
  }
  function downloadData() {
    const blob = new Blob([dataJS()], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "data.js"; a.click();
    URL.revokeObjectURL(a.href);
    toast("Скачан data.js");
  }

  // Карточка размечена, если заполнены все обязательные метки.
  const isMarked = i => i.maturity && i.origin && i.license && i.roles.length && i.contexts.length;

  let query = "";

  // ── Рендер доски ──────────────────────────
  function render() {
    const board = $("#board");
    board.innerHTML = "";
    const visible = D.items.filter(i => {
      if (!query) return true;
      return (i.name + " " + i.description).toLowerCase().includes(query);
    });

    D.categories.forEach(catName => {
      const items = visible.filter(i => i.category === catName);
      if (!items.length) return;
      const cat = document.createElement("section");
      cat.className = "cat";
      cat.innerHTML = `<div class="cat__head"><h2 class="cat__name">${escH(catName)}</h2><span class="cat__num">${items.length}</span></div>`;
      const cards = document.createElement("div");
      cards.className = "cards";
      items.forEach(i => cards.appendChild(card(i)));
      cat.appendChild(cards);
      board.appendChild(cat);
    });

    $("#empty").hidden = visible.length > 0;
    const marked = D.items.filter(isMarked).length;
    $("#progress").textContent = `Размечено ${marked} из ${D.items.length}`;
  }

  function badge(v, cls = "badge--ghost") {
    return v ? `<span class="badge ${cls}">${escH(v)}</span>` : "";
  }

  function card(i) {
    const el = document.createElement("button");
    el.className = "card";
    el.dataset.mat = i.maturity || "";
    el.dataset.marked = isMarked(i) ? "yes" : "no";
    const labels = [
      badge(i.maturity, "badge--mat"), badge(i.origin), badge(i.license),
      ...i.roles.map(r => badge(r)), ...i.contexts.map(c => badge(c)),
    ].filter(Boolean).join("");
    const logo = i.logo
      ? `<span class="card__logo"><img src="logos/${escA(i.logo)}" alt=""></span>`
      : `<span class="card__logo card__logo--ph">1С</span>`;
    el.innerHTML = `
      <div class="card__media">${logo}</div>
      <div class="card__body">
        <div class="card__name">${wbr(i.name)}</div>
        <div class="card__desc">${escH(i.description).slice(0, 120)}</div>
        <div class="card__meta">${labels || '<span class="badge badge--ghost">нет меток</span>'}</div>
        <div class="card__flags">
          ${isMarked(i) ? "" : '<span class="flag flag--todo">не размечено</span>'}
          ${i.umbrella ? '<span class="flag flag--umb">зонтик · раздробить</span>' : ""}
        </div>
      </div>`;
    el.addEventListener("click", () => openEdit(i));
    return el;
  }

  // ── Форма редактирования ──────────────────
  const textRow = (label, field, val) =>
    `<label class="edit__field"><span>${label}</span><input data-field="${field}" value="${escA(val)}"></label>`;
  const areaRow = (label, field, val) =>
    `<label class="edit__field"><span>${label}</span><textarea data-field="${field}" rows="2">${escH(val)}</textarea></label>`;
  const selectRow = (label, field, val, opts) =>
    `<label class="edit__field"><span>${label}</span><select data-field="${field}">${
      opts.map(o => `<option value="${escA(o)}"${o === val ? " selected" : ""}>${escH(o)}</option>`).join("")
    }</select></label>`;

  function openEdit(i) {
    const dlg = $("#edit");
    dlg.innerHTML = `
      <div class="detail__body edit__body">
        <button class="detail__close" aria-label="Закрыть">✕</button>
        <h2 class="edit__title">Карточка</h2>
        ${textRow("Название", "name", i.name)}
        <div class="edit__grid2">
          ${selectRow("Категория", "category", i.category, D.categories)}
          ${textRow("Подкатегория", "subcategory", i.subcategory || "")}
        </div>
        <button id="texttoggle" type="button" class="lnkbtn">✎ Описание и «зачем нужно»</button>
        <div id="textbox" hidden>
          ${areaRow("Описание", "description", i.description)}
          ${areaRow("Зачем нужно", "why", i.why)}
        </div>
        <div class="edit__grid2">
          ${textRow("Сайт", "homepage", i.homepage || "")}
          ${textRow("Репозиторий", "repo", i.repo || "")}
        </div>
        <div id="axisbox"></div>
        <div class="edit__row"><h3>Аналоги</h3><div id="analogsbox" class="reledit"></div></div>
        <div class="edit__row"><h3>Зависимости</h3><div id="dependsbox" class="reledit"></div></div>
        <div class="edit__row">
          <h3>С чего начать</h3>
          <div id="startbox"></div>
          <button id="startadd" class="lnkbtn">+ ссылка</button>
        </div>
        <div class="edit__foot">
          <button id="del" class="lnkbtn lnkbtn--danger">Удалить карточку</button>
          <button id="done" class="btn btn--primary">Готово</button>
        </div>
      </div>`;

    // Текстовые поля → пишем сразу в объект. Пустую строку для homepage/repo/subcategory храним как null.
    dlg.querySelectorAll("[data-field]").forEach(inp => {
      inp.addEventListener("input", () => {
        const f = inp.dataset.field, v = inp.value;
        i[f] = (v === "" && ["homepage", "repo", "subcategory"].includes(f)) ? null : v;
        save();
      });
    });

    dlg.querySelector("#texttoggle").addEventListener("click", () => {
      const box = dlg.querySelector("#textbox");
      box.hidden = !box.hidden;
    });

    const ax = dlg.querySelector("#axisbox");
    AXES.forEach(a => ax.appendChild(axisGroup(a, i)));

    renderRel(i, "analogs");
    renderRel(i, "depends");

    renderStart(i);
    dlg.querySelector("#startadd").addEventListener("click", () => {
      i.start.push({ label: "", url: "" });
      renderStart(i);
      save();
    });

    dlg.querySelector(".detail__close").addEventListener("click", () => dlg.close());
    dlg.querySelector("#done").addEventListener("click", () => dlg.close());
    dlg.querySelector("#del").addEventListener("click", () => {
      if (confirm(`Удалить «${i.name}»?`)) {
        D.items.forEach(o => {                              // чистим ссылки на удаляемую карточку
          o.analogs = (o.analogs || []).filter(n => n !== i.name);
          o.depends = (o.depends || []).filter(n => n !== i.name);
        });
        D.items.splice(D.items.indexOf(i), 1);
        dlg.close();
      }
    });
    dlg.addEventListener("close", render, { once: true });
    dlg.showModal();
  }

  // Группа чипов по оси. Значения берутся строго из axes.*.values (инвариант).
  function axisGroup(a, i) {
    const meta = D.axes[a.key];
    const wrap = document.createElement("div");
    wrap.className = "edit__row";
    wrap.innerHTML = `<h3>${meta.label}${a.multi ? "" : ' · <span class="req">одно</span>'}</h3>`;
    const chips = document.createElement("div");
    chips.className = "chips";
    meta.values.forEach(v => {
      const c = document.createElement("button");
      c.className = "chip";
      c.textContent = v;
      c.setAttribute("aria-pressed", a.multi ? i[a.field].includes(v) : i[a.field] === v);
      c.addEventListener("click", () => {
        if (a.multi) {
          const arr = i[a.field], k = arr.indexOf(v);
          if (k >= 0) arr.splice(k, 1); else arr.push(v);
          c.setAttribute("aria-pressed", arr.includes(v));
        } else {
          i[a.field] = i[a.field] === v ? "" : v;          // повторный клик снимает выбор
          chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x.textContent === i[a.field]));
        }
        save();
      });
      chips.appendChild(c);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  // ── Связи: аналоги / зависимости (двусторонние) ──
  function addRel(i, type, name) {
    const t = D.items.find(x => x.name === name);
    if (!t) return;
    i[type] = i[type] || [];   if (!i[type].includes(name))   i[type].push(name);
    t[type] = t[type] || [];   if (!t[type].includes(i.name)) t[type].push(i.name);
    save();
  }
  function removeRel(i, type, name) {
    const t = D.items.find(x => x.name === name);
    i[type] = (i[type] || []).filter(n => n !== name);
    if (t) t[type] = (t[type] || []).filter(n => n !== i.name);
    save();
  }
  function renderRel(i, type) {
    const sel = type === "analogs" ? "#analogsbox" : "#dependsbox";
    const box = $(sel);
    const cur = i[type] = i[type] || [];
    const tags = cur.map(n =>
      `<span class="reltag">${escH(n)}<button data-rem="${escA(n)}" title="Убрать">✕</button></span>`).join("");
    const cand = D.items.filter(t => t !== i && !cur.includes(t.name));
    const listId = "rellist-" + type;
    const opts = cand.map(t => `<option value="${escA(t.name)}"></option>`).join("");
    box.innerHTML = `<div class="reltags">${tags || '<span class="reltag reltag--empty">нет</span>'}</div>
      <input class="reladd" list="${listId}" placeholder="+ найти и добавить…" autocomplete="off">
      <datalist id="${listId}">${opts}</datalist>`;
    box.querySelectorAll("[data-rem]").forEach(btn =>
      btn.addEventListener("click", () => { removeRel(i, type, btn.dataset.rem); renderRel(i, type); }));
    const names = new Set(cand.map(t => t.name));
    const inp = box.querySelector(".reladd");
    inp.addEventListener("input", () => {
      if (names.has(inp.value)) {                 // выбрано существующее имя — добавляем связь
        addRel(i, type, inp.value);
        renderRel(i, type);
        $(sel).querySelector(".reladd").focus();   // фокус на новое поле — можно добавлять дальше
      }
    });
  }

  function renderStart(i) {
    const box = $("#startbox");
    box.innerHTML = "";
    i.start.forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "startrow";
      row.innerHTML = `
        <input placeholder="подпись" value="${escA(s.label)}">
        <input placeholder="https://…" value="${escA(s.url)}">
        <button class="lnkbtn lnkbtn--danger" title="Удалить">✕</button>`;
      const [labelInp, urlInp] = row.querySelectorAll("input");
      labelInp.addEventListener("input", () => { s.label = labelInp.value; save(); });
      urlInp.addEventListener("input", () => { s.url = urlInp.value; save(); });
      row.querySelector("button").addEventListener("click", () => { i.start.splice(idx, 1); renderStart(i); save(); });
      box.appendChild(row);
    });
  }

  // ── Экспорт / импорт ──────────────────────
  function buildData() {
    // umbrella — служебный флаг редактора; пустые analogs/depends не выгружаем.
    const items = D.items.map(({ umbrella, analogs, depends, ...rest }) => {
      const o = { ...rest };
      if (analogs && analogs.length) o.analogs = analogs;
      if (depends && depends.length) o.depends = depends;
      return o;
    });
    return { categories: D.categories, axes: D.axes, items };
  }
  function dataJS() {
    return "// Данные ландшафта (Вариант B). Сгенерировано редактором разметки (editor.html).\n"
      + "window.LANDSCAPE = " + JSON.stringify(buildData(), null, 2) + ";\n";
  }

  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => t.hidden = true, 1800);
  }

  function blankItem() {
    return {
      name: "Новый инструмент", category: D.categories[0], subcategory: null, logo: null,
      description: "", why: "", homepage: null, repo: null, start: [],
      maturity: "", origin: "", license: "", roles: [], contexts: [],
      analogs: [], depends: [], umbrella: false,
    };
  }

  // Гарантируем массивы у всех карточек (старые данные могут быть без полей связей)
  function normalize() {
    D.items.forEach(it => {
      it.start = it.start || [];
      it.roles = it.roles || [];
      it.contexts = it.contexts || [];
      it.analogs = it.analogs || [];
      it.depends = it.depends || [];
    });
  }

  $("#add").addEventListener("click", () => { const it = blankItem(); D.items.unshift(it); save(); openEdit(it); });
  $("#search").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });

  $("#open").addEventListener("click", openFile);
  $("#save").addEventListener("click", saveFile);
  $("#export").addEventListener("click", downloadData);
  if (!window.showOpenFilePicker) $("#open").hidden = true;   // браузер без File System Access API

  // ── Старт ─────────────────────────────────
  normalize();
  render();
})();
