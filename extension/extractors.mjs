// Чистая упаковка данных входа: без chrome.* и DOM, её же гоняют тесты — и тест магазина,
// который подаёт каждый результат прямо в парсеры его бэкенда.
//
// У каждого сервиса — свои кнопки (actions). Кнопка получает то, что прочитал попап:
//   cookies — карта «имя куки → куки» сайта сервиса (из дублей — самое длинное значение),
//   list    — все куки сайта как есть (для «Скопировать все куки»),
//   session — ответ страницы сессии ChatGPT (/api/auth/session), только для ID аккаунта.
// и возвращает { ok, payload, preview } или { ok: false, reason }: payload — ровно тот текст,
// что ляжет в буфер обмена, preview — что показать вместо него (значение замаскировано).

export const BOT_URL = "https://t.me/cherdax_bot";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const done = (payload, label, shown = maskValue(payload)) => ({ ok: true, payload, preview: { label, value: shown } });
const missing = (reason = "notLoggedIn") => ({ ok: false, reason });

// ChatGPT, сессия: массив куки для chatgpt-pay/payment.py parse_session_file и
// apps/api/src/chatgpt.mjs looksLikeSession.
export function packChatGpt({ cookies } = {}) {
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
  if (!out.length || !out[0].name.startsWith("__Secure-next-auth.session-token")) return missing();
  return done(JSON.stringify(out, null, 2), "Сессия", maskValue(out[0].value));
}

// ChatGPT, ID аккаунта: "account":{"id":…} со страницы сессии, 36 символов. Не user-… —
// тот не подойдёт (packages/shared/src/activation-methods.mjs parseChatGptAccountId).
export function packChatGptAccountId({ session } = {}) {
  if (session === null || session === undefined) return missing();
  const id = session?.account?.id;
  if (typeof id !== "string" || !UUID.test(id)) return missing("noAccountId");
  return done(id.toLowerCase(), "ID аккаунта");
}

// Claude, sessionKey: голый ключ sk-ant-sid… (apps/api/src/claude.mjs parseClaudeCookies).
export function packClaudeKey({ cookies } = {}) {
  const key = get(cookies, "sessionKey");
  return key?.value ? done(key.value, "sessionKey") : missing();
}

// Claude, Organization ID: выбранная сейчас организация (куки lastActiveOrg) — заказ «по
// Organization ID» принимает только сам ID (parseClaudeOrganizationId).
export function packClaudeOrg({ cookies } = {}) {
  const org = get(cookies, "lastActiveOrg") || get(cookies, "activeOrg");
  if (!get(cookies, "sessionKey")) return missing();
  return org?.value && UUID.test(org.value) ? done(org.value.toLowerCase(), "Organization ID") : missing("noOrg");
}

// Grok · X · Cursor, токен входа: голый токен sso с grok.com (apps/api/src/grok.mjs parseGrokCookies).
export function packGrok({ cookies } = {}) {
  const sso = get(cookies, "sso");
  return sso?.value ? done(sso.value, "Токен входа") : missing();
}

// «Все куки»: как экспорт Cookie-Editor (Export as JSON) — массив со всеми полями куки.
// Только если вход есть: без ключевой куки такой экспорт заказу бесполезен.
const COOKIE_FIELDS = ["domain", "expirationDate", "hostOnly", "httpOnly", "name", "path", "sameSite", "secure", "session", "storeId", "value"];
export function packAllCookies(keyCookie) {
  return ({ list } = {}) => {
    const cookies = (Array.isArray(list) ? list : []).filter((c) => c && c.name);
    if (!cookies.some((c) => c.name === keyCookie && c.value)) return missing();
    const out = cookies
      .map((c) => Object.fromEntries(COOKIE_FIELDS.filter((field) => c[field] !== undefined).map((field) => [field, c[field]])))
      .sort((a, b) => a.name.localeCompare(b.name) || String(a.domain).localeCompare(String(b.domain)));
    return done(JSON.stringify(out, null, 2), "Все куки", `${out.length} шт.`);
  };
}

// Тексты на «ты», как на сайте и в боте. needs — что кнопке прочитать заранее.
export const SERVICES = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    site: "chatgpt.com",
    url: "https://chatgpt.com/",
    cookieUrls: ["https://chatgpt.com", "https://chat.openai.com"],
    lead: "Скопирую сессию или ID аккаунта — что просит заказ.",
    loginHint: "Войди на chatgpt.com в аккаунт, на который оформляешь подписку, и нажми ещё раз.",
    actions: [
      { id: "session", label: "Скопировать сессию", needs: "cookies", pack: packChatGpt },
      { id: "account", label: "Скопировать ID аккаунта", needs: "session", pack: packChatGptAccountId }
    ]
  },
  claude: {
    id: "claude",
    name: "Claude",
    site: "claude.ai",
    url: "https://claude.ai/",
    cookieUrls: ["https://claude.ai"],
    lead: "Скопирую то, что просит заказ.",
    loginHint: "Войди на claude.ai в аккаунт, на который оформляешь подписку, и нажми ещё раз.",
    actions: [
      { id: "key", label: "Скопировать sessionKey", needs: "cookies", pack: packClaudeKey },
      { id: "org", label: "Скопировать Organization ID", needs: "cookies", pack: packClaudeOrg },
      { id: "all", label: "Скопировать все куки", needs: "list", pack: packAllCookies("sessionKey") }
    ]
  },
  grok: {
    id: "grok",
    name: "Grok · X · Cursor",
    site: "grok.com",
    url: "https://grok.com/",
    cookieUrls: ["https://grok.com"],
    lead: "Подписка X, Grok и Cursor включается на grok.com — данные беру оттуда.",
    loginHint: "Войди на grok.com тем же аккаунтом, что в X и Cursor, и нажми ещё раз.",
    actions: [
      { id: "sso", label: "Скопировать токен входа", needs: "cookies", pack: packGrok },
      { id: "all", label: "Скопировать все куки", needs: "list", pack: packAllCookies("sso") }
    ]
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
