// Проверки самого расширения: manifest, безопасность, форма выгрузки.
// Запуск: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { packChatGpt, packClaude, packGrok, serviceForHost } from "../extension/extractors.mjs";

const read = (path) => readFileSync(new URL(`../extension/${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cookies = (obj) => new Map(Object.entries(obj).map(([name, value]) => [name, { name, value }]));

test("manifest: MV3, все файлы на месте, пределы Chrome Web Store", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok([...manifest.name].length <= 75);
  assert.ok([...manifest.description].length <= 132);
  for (const file of [manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
    assert.ok(existsSync(new URL(`../extension/${file}`, import.meta.url)), `нет файла ${file}`);
  }
  if (manifest.default_locale) assert.ok(existsSync(new URL(`../extension/_locales/${manifest.default_locale}/messages.json`, import.meta.url)));
});

test("manifest: минимальные разрешения, без фона и <all_urls>", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "cookies"]);
  assert.deepEqual([...manifest.host_permissions].sort(), ["https://chat.openai.com/*", "https://chatgpt.com/*", "https://claude.ai/*", "https://grok.com/*"]);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test("код: ничего не отправляет в сеть, без инлайн-скриптов", () => {
  for (const file of ["popup.js", "extractors.mjs"]) {
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(read(file)), `${file}: сетевой вызов`);
  }
  const html = read("popup.html");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/\son[a-z]+=/i.test(html));
  assert.ok(!/https?:\/\/(?!t\.me\/)/.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), "внешние ресурсы в popup.html");
});

test("ChatGPT: массив куки сессии", () => {
  const res = packChatGpt(cookies({ "__Secure-next-auth.session-token.0": "a", "__Secure-next-auth.session-token.1": "b", "oai-did": "d", other: "x" }));
  assert.deepEqual(JSON.parse(res.payload), [
    { name: "__Secure-next-auth.session-token.0", value: "a" },
    { name: "__Secure-next-auth.session-token.1", value: "b" },
    { name: "oai-did", value: "d" }
  ]);
  assert.equal(packChatGpt(cookies({ "oai-did": "d" })).ok, false);
});

test("Claude: sessionKey и lastActiveOrg, по отдельности тоже", () => {
  const res = packClaude(cookies({ sessionKey: "sk-ant-sid01-xyz", lastActiveOrg: "org-uuid", other: "x" }));
  assert.deepEqual(JSON.parse(res.payload), [{ name: "sessionKey", value: "sk-ant-sid01-xyz" }, { name: "lastActiveOrg", value: "org-uuid" }]);
  assert.deepEqual(res.fields.map((f) => f.copy), ["sk-ant-sid01-xyz", "org-uuid"]);
  assert.equal(packClaude(cookies({ lastActiveOrg: "org" })).ok, false);
});

test("Grok/X/Cursor: токен sso домена grok.com", () => {
  assert.deepEqual(JSON.parse(packGrok(cookies({ sso: "a.b.c" })).payload), [{ name: "sso", value: "a.b.c", domain: ".grok.com" }]);
  assert.equal(packGrok(cookies({})).ok, false);
});

test("сервис по адресу вкладки", () => {
  const id = (host) => serviceForHost(host)?.id ?? null;
  assert.equal(id("chatgpt.com"), "chatgpt");
  assert.equal(id("chat.openai.com"), "chatgpt");
  assert.equal(id("claude.ai"), "claude");
  for (const host of ["grok.com", "x.com", "twitter.com", "www.cursor.com", "authenticator.cursor.sh"]) assert.equal(id(host), "grok");
  for (const host of ["example.com", "notclaude.ai", "evilchatgpt.com", null]) assert.equal(id(host), null);
});
