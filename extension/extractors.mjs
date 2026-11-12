// Чистая упаковка данных входа: без chrome.* и DOM, её же гоняет контрактный тест
// (tests/browser-extension.test.mjs): вывод расширения должен приниматься парсерами
// бэкенда как есть.
//
// На вход — карта «имя куки → { name, value }» (в расширении её наполняет
// chrome.cookies, в тесте — фикстуры). На выход — { ok, payload, fields }:
// payload — ровно тот текст, что вставляет покупатель; fields — строки чека
// (подпись, замаскированное значение и, если поле можно передать отдельно, copy).

export const BOT_URL = "https://t.me/cherdax_bot";

export function maskValue(value) {
  const v = String(value || "");
  if (v.length <= 12) return "•".repeat(Math.max(4, v.length));
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function get(map, name) {
  if (!map) return undefined;
  if (typeof map.get === "function") return map.get(name);
  return map[name];
}

// ChatGPT: массив куки для chatgpt-pay/payment.py parse_session_file и
// apps/api/src/chatgpt.mjs looksLikeSession.
export function packChatGpt(cookies) {
  const out = [];
  const chunk0 = get(cookies, "__Secure-next-auth.session-token.0");
  const chunk1 = get(cookies, "__Secure-next-auth.session-token.1");
  const whole = get(cookies, "__Secure-next-auth.session-token");
  if (chunk0) {
    out.push({ name: "__Secure-next-auth.session-token.0", value: chunk0.value });
    if (chunk1) out.push({ name: "__Secure-next-auth.session-token.1", value: chunk1.value });
  } else if (whole) {
    out.push({ name: "__Secure-next-auth.session-token", value: whole.value });
  }
  const did = get(cookies, "oai-did");
  if (did) out.push({ name: "oai-did", value: did.value });

  if (!out.length || !out[0].name.startsWith("__Secure-next-auth.session-token")) {
    return { ok: false, reason: "notLoggedIn" };
  }
  const fields = [{ label: "Сессия", value: maskValue(out[0].value) }];
  if (did) fields.push({ label: "ID устройства", value: maskValue(did.value) });
  return { ok: true, payload: JSON.stringify(out, null, 2), fields };
}

// Claude: массив куки для apps/api/src/claude.mjs parseClaudeCookies (sessionKey и
// Organization ID из lastActiveOrg). Ключ и ID можно скопировать и по отдельности:
// заказ «по Organization ID» принимает только сам ID (parseClaudeOrganizationId
// отвергает текст с «{»), заказ «по sessionKey» — голый ключ.
export function packClaude(cookies) {
  const key = get(cookies, "sessionKey");
  const org = get(cookies, "lastActiveOrg") || get(cookies, "activeOrg");
  if (!key) return { ok: false, reason: "notLoggedIn" };
  const out = [{ name: "sessionKey", value: key.value }];
  if (org) out.push({ name: org.name, value: org.value });
  const fields = [{ label: "sessionKey", value: maskValue(key.value), copy: key.value }];
  if (org) fields.push({ label: "Organization ID", value: maskValue(org.value), copy: org.value });
  return { ok: true, payload: JSON.stringify(out, null, 2), fields };
}

// Grok/X/Cursor: массив куки с токеном sso домена grok.com для
// apps/api/src/grok.mjs parseGrokCookies.
export function packGrok(cookies) {
  const sso = get(cookies, "sso");
  if (!sso) return { ok: false, reason: "notLoggedIn" };
  return {
    ok: true,
    payload: JSON.stringify([{ name: "sso", value: sso.value, domain: ".grok.com" }], null, 2),
    fields: [{ label: "Токен входа grok.com", value: maskValue(sso.value) }]
  };
}

// Тексты на «ты», как на сайте и в боте.
export const SERVICES = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    site: "chatgpt.com",
    url: "https://chatgpt.com/",
    cookieUrls: ["https://chatgpt.com", "https://chat.openai.com"],
    pack: packChatGpt,
    lead: "Скопирую сессию твоего аккаунта ChatGPT — по ней оформим подписку на него.",
    preview: ["Сессия", "ID устройства"],
    loginHint: "Войди на chatgpt.com в аккаунт, на который оформляешь подписку, и нажми ещё раз."
  },
  claude: {
    id: "claude",
    name: "Claude",
    site: "claude.ai",
    url: "https://claude.ai/",
    cookieUrls: ["https://claude.ai"],
    pack: packClaude,
    lead: "Скопирую ключ входа и Organization ID твоего аккаунта Claude.",
    preview: ["sessionKey", "Organization ID"],
    loginHint: "Войди на claude.ai в аккаунт, на который оформляешь подписку, и нажми ещё раз."
  },
  grok: {
    id: "grok",
    name: "Grok · X · Cursor",
    site: "grok.com",
    url: "https://grok.com/",
    cookieUrls: ["https://grok.com"],
    pack: packGrok,
    lead: "Единая подписка X, Grok и Cursor включается на grok.com. Скопирую оттуда токен входа.",
    preview: ["Токен входа grok.com"],
    loginHint: "Войди на grok.com тем же аккаунтом, что в X и Cursor, и нажми ещё раз."
  }
};

// Домен активной вкладки → сервис. На x.com и cursor.com данные берутся с grok.com.
export function serviceForHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const is = (d) => h === d || h.endsWith(`.${d}`);
  if (is("chatgpt.com") || is("chat.openai.com")) return SERVICES.chatgpt;
  if (is("claude.ai")) return SERVICES.claude;
  if (is("grok.com") || is("x.com") || is("twitter.com") || is("cursor.com") || is("cursor.sh")) return SERVICES.grok;
  return null;
}
