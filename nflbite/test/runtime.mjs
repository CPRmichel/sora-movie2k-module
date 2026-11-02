import vm from "node:vm";
import { readFile } from "node:fs/promises";

export async function runtime(fetchv2) {
  const logs = [];
  const context = vm.createContext({
    fetchv2,
    console: { log: (message) => logs.push(String(message)) },
  });
  const source = await readFile(new URL("../nflbite.js", import.meta.url), "utf8");
  try {
    vm.runInContext(source, context, { timeout: 5000 });
  } catch (error) {
    throw new Error("Module initialization failed: " + error.message);
  }
  return { context, logs };
}

export async function fixtureRuntime(pages) {
  const requests = [];
  const result = await runtime(async (url, headers = {}) => {
    requests.push({ url, headers });
    const item = pages[url];
    return { status: item?.status || 404, text: async () => item?.body || "Not found" };
  });
  return { ...result, requests };
}
