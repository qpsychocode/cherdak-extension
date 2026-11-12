// Поповер. Сервис — по домену активной вкладки (activeTab). По нажатию читает куки
// входа через chrome.cookies (они httpOnly, со страницы их не прочитать) и кладёт
// готовый текст в буфер обмена. Сетевых запросов нет.
import { SERVICES, serviceForHost } from "./extractors.mjs";

const $ = (id) => document.getElementById(id);
let service = null;
let activeHost = null;

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

function getCookies(url) {
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll({ url }, (list) => resolve(chrome.runtime.lastError || !Array.isArray(list) ? [] : list));
    } catch {
      resolve([]);
    }
  });
}

// «Имя → куки»; из дублей (разные пути) — самое длинное значение: цельный токен.
async function cookieMap(svc) {
  const map = new Map();
  for (const url of svc.cookieUrls) {
    for (const c of await getCookies(url)) {
      const prev = map.get(c?.name);
      if (c?.name && (!prev || String(c.value ?? "").length > String(prev.value ?? "").length)) map.set(c.name, c);
    }
  }
  return map;
}

async function readActiveHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ? new URL(tab.url).hostname : null;
  } catch {
    return null;
  }
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

function setLines(rows) {
  $("lines").replaceChildren(...rows.map(([dt, ...dd]) => node("div", {}, node("dt", {}, dt), ...dd)));
}

function setNote(title, text) {
  const note = $("note");
  if (!title) { note.hidden = true; return; }
  note.replaceChildren(node("b", {}, title), text);
  note.hidden = false;
}

function setMain(text, { done = false, action = "copy" } = {}) {
  const btn = $("mainBtn");
  btn.hidden = false;
  btn.disabled = false;
  btn.textContent = text;
  btn.dataset.action = action;
  btn.classList.toggle("is-done", done);
}

function reprint() {
  const paper = $("paper");
  paper.classList.remove("is-reprint");
  void paper.offsetWidth;
  paper.classList.add("is-reprint");
}

// ── состояния ─────────────────────────────────────────────
function showPicker() {
  document.body.dataset.service = "none";
  $("title").textContent = "Открой сервис";
  $("lead").textContent = "Я работаю на этих сайтах. Открой нужный, войди в свой аккаунт и нажми на значок Чердака ещё раз.";
  $("slipSite").textContent = "сервисы";
  setLines(Object.values(SERVICES).map((svc) => [svc.name, node("dd", {}, node("button", { class: "line-open", type: "button", data: { open: svc.url } }, svc.site))]));
  $("mainBtn").hidden = true;
  $("next").hidden = true;
}

function showService() {
  document.body.dataset.service = service.id;
  $("title").textContent = service.name;
  $("lead").textContent = service.lead;
  $("slipSite").textContent = service.site;
  setLines(service.preview.map((label) => [label, node("dd", { class: "is-empty" }, "••••••")]));
  setNote(null);
  setMain("Скопировать данные входа");
  $("next").hidden = false;
}

async function copyAll() {
  const btn = $("mainBtn");
  btn.disabled = true;
  btn.textContent = "Читаю…";
  $("stamp").hidden = true;

  let res;
  try {
    res = service.pack(await cookieMap(service));
  } catch {
    res = { ok: false, reason: "error" };
  }

  if (!res.ok) {
    setLines(service.preview.map((label) => [label, node("dd", { class: "is-empty" }, "нет")]));
    setNote("Вход не найден", service.loginHint);
    const onSite = serviceForHost(activeHost)?.id === service.id && activeHost?.replace(/^www\./, "").endsWith(service.site);
    if (onSite) setMain("Проверить ещё раз");
    else setMain(`Открыть ${service.site}`, { action: "open" });
    reprint();
    return;
  }

  const copied = await writeClipboard(res.payload);
  setLines(res.fields.map((f) => [
    f.label,
    node("dd", {}, f.value),
    ...(f.copy ? [node("button", { class: "line-copy", type: "button", title: `Скопировать только ${f.label}`, data: { copy: f.copy } }, icon("copy"))] : [])
  ]));
  reprint();
  if (copied) {
    setNote(null);
    $("stamp").hidden = false;
    setMain("Скопировано — вставь в заказ", { done: true });
  } else {
    setNote("Буфер обмена недоступен", "Нажми кнопку ещё раз — браузер мог не дать доступ с первого раза.");
    setMain("Скопировать ещё раз");
  }
}

document.addEventListener("click", async (event) => {
  const open = event.target.closest("[data-open]");
  if (open) return openSite(open.dataset.open);
  const one = event.target.closest("[data-copy]");
  if (one) {
    if (await writeClipboard(one.dataset.copy)) {
      document.querySelectorAll(".line-copy.is-done").forEach((b) => b.classList.remove("is-done"));
      one.classList.add("is-done");
    }
    return;
  }
  const main = event.target.closest("#mainBtn");
  if (!main || !service) return;
  if (main.dataset.action === "open") return openSite(service.url);
  copyAll();
});

async function init() {
  activeHost = await readActiveHost();
  service = serviceForHost(activeHost);
  if (service) showService();
  else showPicker();
}

init();
