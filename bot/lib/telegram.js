// Телеграм-транспорт: Bot API голым https (ноль зависимостей), фото
// с кэшем file_id и гигиена чата (удаление сообщений, тосты).
// Все отправленное регистрируется в реестре чата (store.trackMsg) —
// на этом держится полная очистка экрана по «сбросу».
"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");
const { trackMsg } = require("./store");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error("Нужен токен: BOT_TOKEN=<токен> node bot/bot.js");
    process.exit(1);
}

const api = (method, params) =>
    new Promise((resolve, reject) => {
        const body = JSON.stringify(params || {});
        const req = https.request(
            {
                hostname: "api.telegram.org",
                path: `/bot${TOKEN}/${method}`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        const j = JSON.parse(data);
                        j.ok
                            ? resolve(j.result)
                            : reject(new Error(j.description));
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        req.on("error", reject);
        req.end(body);
    });

const send = (chat, text, keyboard) =>
    api("sendMessage", {
        chat_id: chat,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    }).then((r) => trackMsg(chat, r));

// Кэш telegram file_id по файлу логотипа: первый показ грузит файл,
// дальше фото уходит мгновенно по идентификатору — в этом вся скорость
const FILEIDS = path.join(__dirname, "..", "file-ids.json");
let fileIds = {};
try {
    fileIds = JSON.parse(fs.readFileSync(FILEIDS, "utf8"));
} catch (e) {}
const sendPhoto = async (chat, file, caption, keyboard) => {
    if (fileIds[file]) {
        try {
            return trackMsg(
                chat,
                await api("sendPhoto", {
                    chat_id: chat,
                    photo: fileIds[file],
                    caption,
                    parse_mode: "HTML",
                    reply_markup: keyboard
                        ? { inline_keyboard: keyboard }
                        : undefined,
                }),
            );
        } catch (e) {} // file_id протух — перезаливаем файлом
    }
    const res = trackMsg(
        chat,
        await uploadPhoto(chat, file, caption, keyboard),
    );
    const ph = res.photo && res.photo[res.photo.length - 1];
    if (ph) {
        fileIds[file] = ph.file_id;
        fs.writeFileSync(FILEIDS, JSON.stringify(fileIds));
    }
    return res;
};
// Загрузка фото файлом — multipart руками (зависимостей нет)
const uploadPhoto = (chat, file, caption, keyboard) =>
    new Promise((resolve, reject) => {
        const b = "----landscape" + Date.now();
        const fields = { chat_id: String(chat), caption, parse_mode: "HTML" };
        if (keyboard)
            fields.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
        let head = "";
        for (const [k, v] of Object.entries(fields))
            head += `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
        head += `--${b}\r\nContent-Disposition: form-data; name="photo"; filename="${path.basename(file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const body = Buffer.concat([
            Buffer.from(head),
            fs.readFileSync(file),
            Buffer.from(`\r\n--${b}--\r\n`),
        ]);
        const req = https.request(
            {
                hostname: "api.telegram.org",
                path: `/bot${TOKEN}/sendPhoto`,
                method: "POST",
                headers: {
                    "Content-Type": `multipart/form-data; boundary=${b}`,
                    "Content-Length": body.length,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        const j = JSON.parse(data);
                        j.ok
                            ? resolve(j.result)
                            : reject(new Error(j.description));
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        req.on("error", reject);
        req.end(body);
    });

// Сообщение убирается из чата — не копим простыню
const hideCard = (chat, msgId) =>
    api("deleteMessage", { chat_id: chat, message_id: msgId }).catch(() => {});
// Служебный текст тостом: показали и через пару секунд убрали
const toast = async (chat, text, ms = 3000) => {
    const m = await send(chat, text).catch(() => null);
    if (m) setTimeout(() => hideCard(chat, m.message_id), ms);
};

module.exports = { api, send, sendPhoto, hideCard, toast };
