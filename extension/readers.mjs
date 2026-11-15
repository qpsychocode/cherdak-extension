export async function readChatGptSessionInTab() {
  // Chrome serializes this function into the tab. Check its current origin there,
  // since the tab may have navigated after the popup first read its URL.
  if (!["https://chatgpt.com", "https://chat.openai.com"].includes(location.origin)) return null;
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", redirect: "error" });
  return response.ok ? response.text() : null;
}

export async function readServiceCookies(api, tabId, domains, all) {
  const stores = await api.getAllCookieStores();
  const storeId = stores.find((store) => store.tabIds.includes(tabId))?.id;
  if (storeId === undefined) throw new Error("Cookie store unavailable");
  const lists = await Promise.all(domains.map(async (domain) => {
    if (!all) return api.getAll({ url: `https://${domain}/`, storeId });
    try {
      // An empty partition selector includes both partitioned and ordinary cookies
      // in current Chromium. Domain, unlike URL, includes every path.
      return await api.getAll({ domain, storeId, partitionKey: {} });
    } catch (error) {
      if (!/Unexpected property: '?partitionKey'?/i.test(String(error?.message))) throw error;
      return api.getAll({ domain, storeId });
    }
  }));
  return lists.flat();
}
