// Проверки самого расширения: manifest, безопасность, что кладёт в буфер каждая кнопка.
// Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { SERVICES, packAllCookies, packChatGpt, packChatGptAccountId, packClaudeKey, packClaudeOrg, packGrok, serviceForHost } from "../extension/extractors.mjs";

const read = (path) => readFileSync(new URL(`../extension/${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cookies = (obj) => new Map(Object.entries(obj).map(([name, value]) => [name, { name, value }]));
const ORG = "11111111-2222-3333-4444-555555555555";

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
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "cookies", "scripting"]);
  assert.deepEqual([...manifest.host_permissions].sort(), ["https://chat.openai.com/*", "https://chatgpt.com/*", "https://claude.ai/*", "https://grok.com/*"]);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test("код: единственный запрос — страница сессии ChatGPT в его же вкладке; без инлайн-скриптов", () => {
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(read("extractors.mjs")));
  const popup = read("popup.js");
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(popup));
  assert.deepEqual([...popup.matchAll(/\bfetch\(([^,)]+)/g)].map((m) => m[1]), ['"/api/auth/session"'], "fetch только относительный адрес сессии");
  const html = read("popup.html");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!/\son[a-z]+=/i.test(html));
  assert.ok(!/https?:\/\/(?!t\.me\/)/.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), "внешние ресурсы в popup.html");
});

test("кнопки: у каждого сервиса свои, у каждой — подпись и упаковка", () => {
  const labels = Object.fromEntries(Object.values(SERVICES).map((svc) => [svc.id, svc.actions.map((a) => a.label)]));
  assert.deepEqual(labels, {
    chatgpt: ["Скопировать сессию", "Скопировать ID аккаунта"],
    claude: ["Скопировать sessionKey", "Скопировать Organization ID", "Скопировать все куки"],
    grok: ["Скопировать токен входа", "Скопировать все куки"]
  });
  for (const svc of Object.values(SERVICES)) for (const action of svc.actions) {
    assert.equal(typeof action.pack, "function");
    assert.ok(["cookies", "list", "session"].includes(action.needs));
  }
});

test("ChatGPT: сессия — массив куки; ID — account.id со страницы сессии", () => {
  const res = packChatGpt({ cookies: cookies({ "__Secure-next-auth.session-token.0": "a", "__Secure-next-auth.session-token.1": "b", "oai-did": "d", other: "x" }) });
  assert.deepEqual(JSON.parse(res.payload), [
    { name: "__Secure-next-auth.session-token.0", value: "a" },
    { name: "__Secure-next-auth.session-token.1", value: "b" },
    { name: "oai-did", value: "d" }
  ]);
  assert.equal(packChatGpt({ cookies: cookies({ "oai-did": "d" }) }).ok, false);
  assert.equal(packChatGptAccountId({ session: { account: { id: ORG.toUpperCase() } } }).payload, ORG);
  assert.equal(packChatGptAccountId({ session: null }).reason, "notLoggedIn");
  assert.equal(packChatGptAccountId({ session: { account: { id: "user-abc" } } }).reason, "noAccountId");
});

test("Claude: sessionKey, Organization ID и все куки", () => {
  const map = cookies({ sessionKey: "sk-ant-sid01-xyz", lastActiveOrg: ORG, other: "x" });
  assert.equal(packClaudeKey({ cookies: map }).payload, "sk-ant-sid01-xyz");
  assert.equal(packClaudeOrg({ cookies: map }).payload, ORG);
  assert.equal(packClaudeOrg({ cookies: cookies({ sessionKey: "sk" }) }).reason, "noOrg");
  assert.equal(packClaudeKey({ cookies: cookies({ lastActiveOrg: ORG }) }).ok, false);
  const list = [
    { name: "sessionKey", value: "sk-ant-sid01-xyz", domain: ".claude.ai", path: "/", httpOnly: true, secure: true, sameSite: "lax", session: false, expirationDate: 1, hostOnly: false, storeId: "0" },
    { name: "lastActiveOrg", value: ORG, domain: ".claude.ai", path: "/", httpOnly: false, secure: true, sameSite: "lax", session: false, expirationDate: 1, hostOnly: false, storeId: "0" }
  ];
  const all = JSON.parse(packAllCookies("sessionKey")({ list }).payload);
  assert.deepEqual(all.map((c) => c.name), ["lastActiveOrg", "sessionKey"]);
  assert.deepEqual(Object.keys(all[1]).sort(), ["domain", "expirationDate", "hostOnly", "httpOnly", "name", "path", "sameSite", "secure", "session", "storeId", "value"]);
  assert.equal(packAllCookies("sessionKey")({ list: list.slice(1) }).ok, false, "без ключа входа — не экспорт");
});

test("Grok/X/Cursor: токен sso и все куки grok.com", () => {
  assert.equal(packGrok({ cookies: cookies({ sso: "a.b.c" }) }).payload, "a.b.c");
  assert.equal(packGrok({ cookies: cookies({}) }).ok, false);
  const all = JSON.parse(packAllCookies("sso")({ list: [{ name: "sso", value: "a.b.c", domain: ".grok.com" }, { name: "x", value: "1", domain: "grok.com" }] }).payload);
  assert.deepEqual(all.map((c) => c.name), ["sso", "x"]);
});

test("сервис по адресу вкладки", () => {
  const id = (host) => serviceForHost(host)?.id ?? null;
  assert.equal(id("chatgpt.com"), "chatgpt");
  assert.equal(id("chat.openai.com"), "chatgpt");
  assert.equal(id("claude.ai"), "claude");
  for (const host of ["grok.com", "x.com", "twitter.com", "www.cursor.com", "authenticator.cursor.sh"]) assert.equal(id(host), "grok");
  for (const host of ["example.com", "notclaude.ai", "evilchatgpt.com", null]) assert.equal(id(host), null);
});
