// Чистая упаковка данных входа: без chrome.* и DOM, её же гоняют тесты — и тест магазина,
// который подаёт каждый результат прямо в парсеры его бэкенда.
//
// У каждого сервиса — свои кнопки (actions). Кнопка получает то, что прочитал попап:
//   cookies — куки, которые браузер отправляет при открытии главной страницы сервиса,
//   list    — все куки разрешённых доменов сервиса,
//   session — исходный текст страницы сессии ChatGPT (/api/auth/session).
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

function readSessionJson(session) {
  if (!session) return null;
  try {
    return JSON.parse(session);
  } catch {
    return null;
  }
}

export function packChatGpt({ session } = {}) {
  const data = readSessionJson(session);
  if (!data?.user || data.error || ![data.accessToken, data.sessionToken].some((value) => typeof value === "string" && value.trim())) {
    return missing();
  }
  return done(session, "Сессия", "JSON целиком");
}

// ChatGPT, ID аккаунта: "account":{"id":…} со страницы сессии, 36 символов. Не user-… —
// тот не подойдёт (packages/shared/src/activation-methods.mjs parseChatGptAccountId).
export function packChatGptAccountId({ session } = {}) {
  const data = readSessionJson(session);
  if (!data?.user || data.error) return missing();
  const id = data.account?.id;
  if (typeof id !== "string" || !UUID.test(id)) return missing("noAccountId");
  return done(id, "ID аккаунта");
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
  return org?.value && UUID.test(org.value) ? done(org.value, "Organization ID") : missing("noOrg");
}

// Grok · X · Cursor, токен входа: голый токен sso с grok.com (apps/api/src/grok.mjs parseGrokCookies).
export function packGrok({ cookies } = {}) {
  const sso = get(cookies, "sso");
  return sso?.value ? done(sso.value, "Токен входа") : missing();
}

// Показываем количество, а в буфер идут все записи именно в том виде, в котором их выдал Chrome.
export function packAllCookies({ list } = {}) {
  if (!list?.length) return missing();
  return done(JSON.stringify(list, null, 2), "Все куки", `${list.length} шт.`);
}

// Тексты на «ты», как на сайте и в боте. needs — что кнопке прочитать заранее.
export const SERVICES = {
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    site: "chatgpt.com",
    url: "https://chatgpt.com/",
    cookieDomains: ["chatgpt.com", "chat.openai.com"],
    lead: "Скопирую сессию целиком, ID аккаунта или все куки.",
    loginHint: "Войди на chatgpt.com в аккаунт, на который оформляешь подписку, и нажми ещё раз.",
    actions: [
      { id: "session", label: "Скопировать сессию", needs: "session", pack: packChatGpt },
      { id: "account", label: "Скопировать ID аккаунта", needs: "session", pack: packChatGptAccountId },
      { id: "all", label: "Скопировать все куки", needs: "list", pack: packAllCookies }
    ]
  },
  claude: {
    id: "claude",
    name: "Claude",
    site: "claude.ai",
    url: "https://claude.ai/",
    cookieDomains: ["claude.ai"],
    lead: "Скопирую то, что просит заказ.",
    loginHint: "Войди на claude.ai в аккаунт, на который оформляешь подписку, и нажми ещё раз.",
    actions: [
      { id: "key", label: "Скопировать sessionKey", needs: "cookies", pack: packClaudeKey },
      { id: "org", label: "Скопировать Organization ID", needs: "cookies", pack: packClaudeOrg },
      { id: "all", label: "Скопировать все куки", needs: "list", pack: packAllCookies }
    ]
  },
  grok: {
    id: "grok",
    name: "Grok · X · Cursor",
    site: "grok.com",
    url: "https://grok.com/",
    cookieDomains: ["grok.com"],
    lead: "Подписка X, Grok и Cursor включается на grok.com — данные беру оттуда.",
    loginHint: "Войди на grok.com тем же аккаунтом, что в X и Cursor, и нажми ещё раз.",
    actions: [
      { id: "sso", label: "Скопировать токен входа", needs: "cookies", pack: packGrok },
      { id: "all", label: "Скопировать все куки", needs: "list", pack: packAllCookies }
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
