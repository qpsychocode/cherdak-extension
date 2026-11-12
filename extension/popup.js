// Поповер. Сервис — по домену активной вкладки (activeTab). Каждая кнопка по нажатию читает
// своё и кладёт готовый текст в буфер обмена:
//   куки сайта сервиса — через chrome.cookies (они httpOnly, страница их не видит);
//   ID аккаунта ChatGPT — страница сессии chatgpt.com/api/auth/session, которую открытая вкладка
//   ChatGPT читает у себя же (chrome.scripting); из ответа берётся только account.id.
// Больше никаких запросов: на свои или чужие серверы расширение ничего не отправляет.
import { SERVICES, serviceForHost } from "./extractors.mjs";

const $ = (id) => document.getElementById(id);
let service = null;
let activeTab = null;

function node(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "data") Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...children);
  return n;
}
function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "i");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
const hostOf = (tab) => { try { return tab?.url ? new URL(tab.url).hostname : null; } catch { return null; } };

// ── чтение ────────────────────────────────────────────────
function getCookies(url) {
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll({ url }, (list) => resolve(chrome.runtime.lastError || !Array.isArray(list) ? [] : list));
    } catch {
      resolve([]);
    }
  });
}

async function cookieList(svc) {
  const seen = new Set();
  const out = [];
  for (const url of svc.cookieUrls) {
    for (const c of await getCookies(url)) {
      const key = `${c.name}\u0000${c.domain}\u0000${c.path}`;
      if (c?.name && !seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}

// «Имя → куки»; из дублей (разные пути) — самое длинное значение: цельный токен.
function cookieMap(list) {
  const map = new Map();
  for (const c of list) {
    const prev = map.get(c.name);
    if (!prev || String(c.value ?? "").length > String(prev.value ?? "").length) map.set(c.name, c);
  }
  return map;
}

// Выполняется во вкладке chatgpt.com: та же страница сессии, что открывает сам ChatGPT.
// Наружу уходит только account.id; null — входа нет.
async function readAccountInTab() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.user ? { account: { id: data.account?.id ?? null } } : null;
  } catch {
    return null;
  }
}

async function readChatGptSession() {
  if (!activeTab?.id || serviceForHost(hostOf(activeTab))?.id !== "chatgpt") return null;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func: readAccountInTab });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

async function readFor(action) {
  if (action.needs === "session") return { session: await readChatGptSession() };
  const list = await cookieList(service);
  return { list, cookies: cookieMap(list) };
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = node("textarea", { value: text });
    ta.setAttribute("readonly", "");
    ta.className = "sprite";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function openSite(url) {
  try { chrome.tabs.create({ url }); } catch { window.open(url, "_blank", "noopener"); }
  window.close();
}

// ── экран ─────────────────────────────────────────────────
const PROBLEMS = {
  notLoggedIn: (svc) => ["Вход не найден", svc.loginHint],
  noAccountId: () => ["ID аккаунта не нашёлся", "Обнови страницу ChatGPT и нажми ещё раз. Если не выйдет — пришли сессию."],
  noOrg: () => ["Organization ID не нашёлся", "Выбери нужную организацию в меню аккаунта Claude, обнови страницу и нажми ещё раз."],
  noClipboard: () => ["Буфер обмена недоступен", "Нажми кнопку ещё раз — браузер мог не дать доступ с первого раза."],
  error: () => ["Не получилось прочитать", "Обнови страницу сервиса и нажми ещё раз."]
};

function setNote(problem) {
  const note = $("note");
  // Пока копировать нечего, шаги «вставь в заказ» ни к чему — и попап остаётся в 600 px.
  $("next").hidden = Boolean(problem);
  if (!problem) { note.hidden = true; return; }
  const [title, text] = (PROBLEMS[problem] ?? PROBLEMS.error)(service);
  const parts = [node("b", {}, title), text];
  // На x.com и cursor.com (или когда вкладка не на сайте сервиса) — открыть нужный сайт.
  if (problem === "notLoggedIn" && !hostOf(activeTab)?.replace(/^www\./, "").endsWith(service.site)) {
    parts.push(node("button", { class: "btn btn-ghost btn-block note-open", type: "button", data: { open: service.url } }, `Открыть ${service.site}`));
  }
  note.replaceChildren(...parts);
  note.hidden = false;
}

function renderActions() {
  $("actions").replaceChildren(...service.actions.map((action, index) => node("button", {
    class: `btn btn-block ${index === 0 ? "btn-primary" : "btn-ghost"}`, type: "button", data: { action: action.id }
  }, icon("copy"), action.label)));
}

function showPicker() {
  document.body.dataset.service = "none";
  $("title").textContent = "Открой сервис";
  $("lead").textContent = "Работаю на этих сайтах. Открой нужный, войди в свой аккаунт и нажми на значок Чердака ещё раз.";
  $("slipSite").textContent = "сервисы";
  $("actions").replaceChildren(...Object.values(SERVICES).map((svc) => node("button", {
    class: "btn btn-ghost btn-block btn-site", type: "button", data: { open: svc.url }
  }, node("span", {}, svc.name), node("small", {}, svc.site))));
  $("next").hidden = true;
}

function showService() {
  document.body.dataset.service = service.id;
  $("title").textContent = service.name;
  $("lead").textContent = service.lead;
  $("slipSite").textContent = service.site;
  renderActions();
  $("next").hidden = false;
}

function reprint() {
  const paper = $("paper");
  paper.classList.remove("is-reprint");
  void paper.offsetWidth;
  paper.classList.add("is-reprint");
}

async function run(actionId, button) {
  const action = service.actions.find((item) => item.id === actionId);
  if (!action) return;
  const buttons = [...$("actions").querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  setNote(null);
  $("stamp").hidden = true;

  let res;
  try {
    res = action.pack(await readFor(action));
  } catch {
    res = { ok: false, reason: "error" };
  }
  if (res.ok && !(await writeClipboard(res.payload))) res = { ok: false, reason: "noClipboard" };

  renderActions();
  reprint();
  if (!res.ok) {
    $("copied").hidden = true;
    setNote(res.reason);
    return;
  }
  const doneButton = $("actions").querySelector(`[data-action="${actionId}"]`) ?? button;
  doneButton.classList.add("is-done");
  doneButton.replaceChildren(icon("check"), "Скопировано");
  $("copied").replaceChildren(node("span", {}, res.preview.label), node("b", {}, res.preview.value));
  $("copied").hidden = false;
  $("stamp").hidden = false;
}

document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open]");
  if (open) return openSite(open.dataset.open);
  const button = event.target.closest("[data-action]");
  if (button && service) run(button.dataset.action, button);
});

async function init() {
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    activeTab = null;
  }
  service = serviceForHost(hostOf(activeTab));
  if (service) showService();
  else showPicker();
}

init();
