// Start `npm run start -- --port 3107`, then run this file with Node.
// Uses installed Chrome, an isolated temporary profile and browser storage only.
// Public order requests are blocked; this test never writes application data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.LOTUS_TEST_URL ?? "http://127.0.0.1:3107";
const profile = await mkdtemp(join(tmpdir(), "lotus-constructor-test-"));
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
], { windowsHide: true, stdio: "ignore" });
let socket;
let sequence = 0;
const pending = new Map();
const errors = [];
async function until(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(message);
}
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (result) => { clearTimeout(timeout); resolve(result); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const cart = () => evaluate("JSON.parse(localStorage.getItem('lotus-cart') || '[]')");
try {
  const port = await until(async () => {
    try { return (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; }
  }, "Chrome failed to start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["*/api/orders*", "*/api/admin/*"] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/catalog` });
  await until(() => evaluate("!!document.querySelector('button[aria-label^=\"Добавить\"]')"), "Catalog did not render");
  await delay(500);
  await evaluate("document.querySelector('button[aria-label^=\"Добавить\"]').click()");
  const catalogCart = await until(async () => { const items = await cart(); return items.length && items; }, "Catalog add failed");
  const productId = catalogCart[0].productId;
  await send("Page.navigate", { url: `${base}/` });
  await until(() => evaluate("!!document.querySelector('.bouquetBottom button:not(:disabled)')"), "Home did not hydrate");
  await evaluate(`Array.from(document.querySelectorAll('.bouquetCard')).find((card) => card.querySelector('h3').textContent === ${JSON.stringify(catalogCart[0].name)}).querySelector('button').click()`);
  await until(async () => (await cart()).some((item) => item.productId === productId && item.quantity === 2), "Cart did not merge home and catalog additions");

  await send("Page.navigate", { url: `${base}/bouquet-builder` });
  const count = await until(() => evaluate("Array.from(document.querySelectorAll('aside button')).filter((button) => button.textContent.includes('Доступно:')).length"), "Constructor assortment did not load");
  assert.ok(count > 3, "Constructor must list more than the three legacy kinds");
  assert.equal(await evaluate("/\\?{3,}/.test(document.body.innerText)"), false, "Russian labels must not be corrupted");
  await evaluate("Array.from(document.querySelectorAll('aside button')).find((button) => button.textContent.includes('Доступно:') && !button.disabled).click()");
  await until(() => evaluate("document.querySelectorAll('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').length === 1"), "No map marker for stock flower");
  await until(() => evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1') || 'null')?.configuration.schemaVersion === 2"), "Draft did not save as v2");
  const before = await evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')).configuration.flowers[0]");
  const marker = await evaluate("(() => { const r=document.querySelector('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...marker, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: marker.x + 18, y: marker.y + 10, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: marker.x + 18, y: marker.y + 10, button: "left", clickCount: 1 });
  const moved = await until(async () => {
    const flower = await evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')).configuration.flowers[0]");
    return JSON.stringify(flower.position) !== JSON.stringify(before.position) && flower;
  }, "Map drag did not change saved geometry");
  assert.equal(moved.flowerId, before.flowerId);
  await evaluate("document.querySelector('[aria-label=\"Посмотреть букет\"]').click()");
  await until(() => evaluate("!!document.querySelector('[aria-labelledby=\"bouquet-preview-title\"] svg')"), "Model-free preview must show a complete map");
  assert.equal(await evaluate("document.querySelector('[aria-labelledby=\"bouquet-preview-title\"]').textContent.includes('3D-модель этого цветка пока не добавлена')"), true);
  await evaluate("document.querySelector('[aria-label=\"Закрыть превью\"]').click()");
  await evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Добавить в корзину').click()");
  const custom = await until(async () => (await cart()).find((item) => item.itemType === "custom-bouquet"), "Custom item not saved");
  assert.equal(custom.configuration.schemaVersion, 2);
  assert.deepEqual(custom.configuration.flowers[0].position, moved.position);
  assert.equal(custom.thumbnail, undefined, "Do not present an incomplete 3D image as a complete bouquet");
  await send("Page.navigate", { url: `${base}/bouquet-builder?edit=${encodeURIComponent(custom.id)}` });
  await until(() => evaluate("document.body.textContent.includes('Вы редактируете авторский букет из корзины')"), "Edit did not load");
  await until(() => evaluate("document.querySelectorAll('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').length === 1"), "Saved stock flower disappeared");
  await evaluate("document.querySelector('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  await until(() => evaluate("!!document.querySelector('[aria-label=\"Удалить выбранный цветок\"]')"), "Map selection failed");
  await evaluate("document.querySelector('[aria-label=\"Удалить выбранный цветок\"]').click()");
  await until(() => evaluate("document.querySelectorAll('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').length === 0"), "Delete failed");
  assert.equal((await cart()).find((item) => item.id === custom.id).configuration.flowers.length, 1, "Unsaved edit must not mutate cart");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("PASS: shared cart; stock assortment; model-free map selection/drag/delete; v2 save and edit; no page exceptions.");
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    console.error("Page state:", await evaluate("document.body.innerText.slice(0, 2500)").catch(() => "unavailable"));
    console.error("Page exceptions:", JSON.stringify(errors));
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    socket.close();
  }
  if (chrome.exitCode === null) await new Promise((resolve) => { chrome.once("exit", resolve); setTimeout(() => { chrome.kill(); resolve(); }, 2000).unref(); });
  const resolvedProfile = await realpath(profile);
  assert.equal(dirname(resolvedProfile), await realpath(tmpdir()));
  assert.ok(basename(resolvedProfile).startsWith("lotus-constructor-test-"));
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
}
