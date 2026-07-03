// Логотипы карточек. Телеграм не принимает SVG, поэтому векторные логотипы
// заранее отрендерены в PNG (node bot/render-logos.js, нужен macOS) и
// закоммичены в bot/logos-png/ — сам бот ничего не рендерит и запускается
// на любой ОС. Растровые берутся из app/logos/ как есть.
"use strict";
const fs = require("fs");
const path = require("path");

const LOGOS = path.join(__dirname, "..", "..", "app", "logos");
const PNG = path.join(__dirname, "..", "logos-png");

const logoFile = (i) => {
    if (!i.logo) return null;
    const f = /\.svg$/i.test(i.logo)
        ? path.join(PNG, i.logo + ".png")
        : path.join(LOGOS, i.logo);
    return fs.existsSync(f) ? f : null;
};

module.exports = { logoFile, LOGOS, PNG };
