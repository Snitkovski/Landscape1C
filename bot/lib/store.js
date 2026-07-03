// Хранилище бота: журнал ответов (JSONL, append-only), состояние сессий
// и обезличивание респондентов. Единственный модуль, знающий про файлы, —
// при переезде на БД меняется только он.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ANSWERS = path.join(__dirname, "..", "answers.jsonl");
const STATE = path.join(__dirname, "..", "state.json");
const SALT = process.env.BOT_SALT || "landscape1c-proto"; // в проде задать свою

// Респондент в данных — только соленый хеш telegram-id
const uid = (id) =>
    crypto
        .createHash("sha256")
        .update(SALT + id)
        .digest("hex")
        .slice(0, 16);

const saveAnswer = (rec) =>
    fs.appendFileSync(ANSWERS, JSON.stringify(rec) + "\n");

let state = {};
try {
    state = JSON.parse(fs.readFileSync(STATE, "utf8"));
} catch (e) {}
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state));

// Последний ответ пользователя по каждому инструменту из журнала
const myAnswers = (chat) => {
    if (!fs.existsSync(ANSWERS)) return [];
    const my = new Map();
    fs.readFileSync(ANSWERS, "utf8")
        .split("\n")
        .filter(Boolean)
        .forEach((l) => {
            try {
                const r = JSON.parse(l);
                if (r.uid === uid(chat)) my.set(r.tool, r);
            } catch (e) {}
        });
    return [...my.values()];
};

// «Сброс»: стираем все ответы пользователя из журнала
const eraseAnswers = (chat) => {
    if (!fs.existsSync(ANSWERS)) return;
    const keep = fs
        .readFileSync(ANSWERS, "utf8")
        .split("\n")
        .filter(Boolean)
        .filter((l) => {
            try {
                return JSON.parse(l).uid !== uid(chat);
            } catch (e) {
                return true;
            }
        });
    fs.writeFileSync(ANSWERS, keep.length ? keep.join("\n") + "\n" : "");
};

// Реестр отправленных ботом сообщений (живет в состоянии чата) —
// чтобы «сброс» мог вычистить с экрана вообще все
const trackMsg = (chat, res) => {
    const s = state[chat];
    if (s && res && res.message_id) {
        (s.msgs = s.msgs || []).push(res.message_id);
        if (s.msgs.length > 300) s.msgs.splice(0, s.msgs.length - 300);
        saveState();
    }
    return res;
};

module.exports = {
    uid,
    saveAnswer,
    state,
    saveState,
    myAnswers,
    eraseAnswers,
    trackMsg,
};
