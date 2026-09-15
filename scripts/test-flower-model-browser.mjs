// Start `npm run dev -- --port 3108 --hostname 127.0.0.1`, then run this script.
// Creates/removes a temporary UI-only route. All model requests are intercepted;
// all other API writes are blocked. No working database data or assets are modified.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { technicalGlb } from "./fixtures/technical-glb.mjs";

const base = process.env.LOTUS_TEST_URL ?? "http://127.0.0.1:3108";
const routeDirectory = resolve("src/app/lotus-model-test-fixture");
await mkdir(routeDirectory); // Fail rather than overwrite an existing directory.
const profile = await mkdtemp(join(tmpdir(), "lotus-model-browser-"));
const glb = technicalGlb(undefined, true);
const testFile = join(profile, "technical-fixture.glb");
await writeFile(testFile, glb);
const assetA = "11111111-1111-4111-8111-111111111111", assetB = "22222222-2222-4222-8222-222222222222";
const missingAsset = "33333333-3333-4333-8333-333333333333";
const settings = { scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0] };
const assigned = { assetId: assetA, settings, fileName: "technical-fixture.glb", byteLength: glb.length };
let saved = assigned;
await writeFile(join(routeDirectory, "page.tsx"), `"use client";
import { useEffect, useState } from "react";
import { _roots } from "@react-three/fiber";
import { AdminFlowerModel } from "@/components/admin-flower-model";
import { BouquetConstructorLoader } from "@/components/bouquet-constructor-loader";
import AdminBouquetViewerCanvas from "@/components/admin-bouquet-viewer-canvas";
const model = ${JSON.stringify(assigned)};
const flowers = [{id:"9223372036854775700",name:"Technical fixture A",salePrice:12,availableQuantity:21,color:null,imageUrl:null,model}, {id:"9223372036854775701",name:"No model fixture",salePrice:15,availableQuantity:21,color:null,imageUrl:null}, {id:"9223372036854775702",name:"Failed model fixture",salePrice:18,availableQuantity:21,color:null,imageUrl:null,model:{...model,assetId:"${missingAsset}"}}];
export default function Page() {
 const [mode,setMode]=useState("admin");
 useEffect(()=>{Object.defineProperty(window,"lotusTestRoots",{configurable:true,get:()=>Array.from(_roots.values()).map(root=>root.store.getState())});return()=>{delete (window as unknown as {lotusTestRoots?:unknown}).lotusTestRoots}},[]);
 return <><nav>{["admin","builder","viewer","legacy"].map(v=><button key={v} data-test-mode={v} onClick={()=>setMode(v)}>{v}</button>)}</nav>
 {mode==="admin" ? <AdminFlowerModel flowerId="9223372036854775700" initialModel={model}/> : mode==="builder" ? <div style={{height:950}}><BouquetConstructorLoader flowers={flowers} legacyLinks={{}}/></div> : <div style={{height:750}}><AdminBouquetViewerCanvas viewMode="3d" configuration={mode==="legacy" ? {schemaVersion:1,wrappingKind:"blush",flowers:[{id:"legacy",kind:"rose",position:[0,0,0],rotation:[0,0,0]}]} : {schemaVersion:2,wrappingKind:"blush",flowers:[{id:"saved",flowerId:flowers[0].id,position:[0,0,0],rotation:[0,0,0],snapshot:{name:flowers[0].name,salePrice:12,color:null,imageUrl:null,model}}]}}/></div>}</>;
}`, { flag: "wx" });
const chrome = spawn(process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
], { windowsHide: true, stdio: "ignore" });
let socket, sequence = 0;
const pending = new Map(), errors = [], fetches = new Map();
async function until(check, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(150); }
  throw new Error(message);
}
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function intercept({ requestId, request }) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/flower-models/")) {
    fetches.set(pathname, (fetches.get(pathname) ?? 0) + 1);
    if (pathname.endsWith(missingAsset)) return send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" });
    return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "model/gltf-binary" }], body: glb.toString("base64") });
  }
  if (pathname === "/api/admin/flowers/9223372036854775700/model") {
    if (request.method === "POST") saved = { ...assigned, assetId: assetB, settings: JSON.parse(Object.entries(request.headers).find(([key]) => key.toLowerCase() === "x-model-settings")[1]) };
    if (request.method === "PATCH") saved = { ...saved, settings: JSON.parse(request.postData) };
    if (request.method === "DELETE") saved = null;
    return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ model: saved })).toString("base64") });
  }
  return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
}
const clickText = (text) => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`);
const mode = async (name) => { await evaluate(`document.querySelector('[data-test-mode="${name}"]').click()`); await delay(500); };
const ready = () => evaluate("window.lotusTestRoots?.some(r=>{let n=0;r.scene.traverse(o=>{if(o.userData.modelStatus==='ready')n++});return n>0})");
try {
  const port = await until(async () => { try { return (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; } }, "Chrome failed to start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
    if (message.method === "Fetch.requestPaused") void intercept(message.params).catch(e => errors.push(String(e)));
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); if (message.error) task.reject(message.error); else task.resolve(message.result);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/lotus-model-test-fixture` });
  await until(ready, "Assigned GLB preview did not load");
  await writeFile(resolve(".next/flower-model-preview-test.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="Размер модели"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1.5');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Сохранить модель'&&!b.disabled)"), "Scale edit was not detected");
  await clickText("Сохранить модель");
  await until(() => evaluate("document.body.innerText.includes('Модель и настройки сохранены')"), "Settings were not saved");
  assert.equal(saved.settings.scale, 1.5);
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="Поворот Y"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'90');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickText("Сохранить модель");
  await until(() => saved?.settings.rotation[1] === Math.PI / 2, "Orientation was not saved");
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Сохранить модель'&&b.disabled)"), "Orientation request did not finish");
  const doc = await send("DOM.getDocument");
  const input = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [testFile] });
  await until(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Сохранить модель'&&!b.disabled)"), "Local file preview did not load");
  assert.equal(saved.assetId, assetA, "Selecting a file must not persist it");
  await clickText("Сохранить модель");
  await until(() => saved?.assetId === assetB, "Replacement was not sent");
  await until(() => evaluate("document.body.innerText.includes('Модель и настройки сохранены')"), "Replacement did not finish");
  await clickText("Убрать модель");
  await until(() => evaluate("document.body.innerText.includes('Модель убрана')"), "Unlink did not update the UI");
  assert.equal(saved, null);

  await mode("builder");
  await until(() => evaluate("document.body.innerText.includes('Technical fixture A')"), "Constructor fixture did not load");
  const add = "Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent.includes('Technical fixture A')&&b.textContent.includes('Доступно:')).click()";
  await evaluate(add); await delay(300); await evaluate(add);
  await until(() => evaluate("window.lotusTestRoots?.some(r=>r.scene.children.length && (()=>{let n=0;r.scene.traverse(o=>{if(o.userData.instanceId)n++});return n===2})())"), "Two model instances did not mount");
  await until(ready, "Constructor models did not load"); await delay(1200);
  const independence = await evaluate("(()=>{const r=window.lotusTestRoots.find(r=>r.scene.getObjectByProperty('name','flower-instance-'+JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')).configuration.flowers[0].id));const groups=[];r.scene.traverse(o=>{if(o.userData.instanceId)groups.push(o)});const meshes=groups.map(g=>{let m;g.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position?.count===3)m=o});return m});return {count:groups.length,objects:meshes[0]!==meshes[1],geometry:meshes[0].geometry===meshes[1].geometry,material:meshes[0].material===meshes[1].material}})()");
  assert.deepEqual(independence, { count: 2, objects: true, geometry: true, material: true });
  assert.equal(await evaluate("window.lotusTestRoots.some(r=>{let textured=false;r.scene.traverse(o=>{if(o.isMesh&&o.material.map?.image)textured=true});return textured})"), true, "Embedded textures must survive loading and cloning");
  assert.equal(fetches.get(`/api/flower-models/${assetA}`), 1, "Source GLB must be cached across preview and multiple instances");
  // Hit a real uploaded triangle through the camera, rather than a procedural substitute.
  const hit = await evaluate("(()=>{const r=window.lotusTestRoots.find(r=>{let found=false;r.scene.traverse(o=>{if(o.userData.instanceId)found=true});return found});let mesh;r.scene.traverse(o=>{if(!mesh&&o.isMesh&&o.geometry.attributes.position?.count===3)mesh=o});const p=mesh.geometry.boundingBox.getCenter(r.camera.position.clone());mesh.localToWorld(p);p.project(r.camera);const rect=r.gl.domElement.getBoundingClientRect();return {x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2}})()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...hit, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...hit, button: "left", clickCount: 1 });
  await until(() => evaluate("!!document.querySelector('[aria-label=\"Удалить выбранный цветок\"]')"), "Uploaded mesh pointer selection failed");
  const before = await evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')).configuration.flowers");
  const marker = await evaluate("(()=>{const r=document.querySelector('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...marker, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: marker.x + 20, y: marker.y + 10, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: marker.x + 20, y: marker.y + 10, button: "left", clickCount: 1 });
  await until(async () => JSON.stringify(await evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')).configuration.flowers[0].position")) !== JSON.stringify(before[0].position), "GLB instance could not move on the map");
  await clickText("Добавить в корзину");
  const cart = await until(() => evaluate("JSON.parse(localStorage.getItem('lotus-cart')||'[]').find(i=>i.itemType==='custom-bouquet')"), "Model composition did not reach cart");
  assert.equal(cart.configuration.flowers.length, 2);
  assert.equal(cart.configuration.flowers[0].snapshot.model.assetId, assetA);
  assert.ok(cart.thumbnail?.startsWith("data:image/"));
  await send("Page.navigate", { url: `${base}/lotus-model-test-fixture` });
  await until(() => evaluate("!!document.querySelector('[data-test-mode=viewer]')"), "Fixture did not reopen");
  await mode("viewer"); await until(ready, "Saved model snapshot did not render");
  await mode("legacy"); await until(() => evaluate("window.lotusTestRoots?.some(r=>{let n=0;r.scene.traverse(o=>{if(o.isMesh)n++});return n>5})"), "Legacy v1 did not render");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await evaluate("localStorage.removeItem('lotus:bouquet-draft:v1')");
  await mode("builder");
  await until(() => evaluate("Array.from(document.querySelectorAll('aside button')).some(b=>b.textContent.includes('Failed model fixture'))"), "Error fixture did not load");
  await evaluate("Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent.includes('Failed model fixture')&&b.textContent.includes('Доступно:')).click()");
  await until(() => evaluate("document.body.innerText.includes('Не удалось загрузить 3D-модель')"), "A failed GLB needs a local, understandable fallback");
  assert.equal(await evaluate("document.querySelectorAll('svg[aria-label=\"Интерактивная карта букета, вид сверху\"] g[role=button]').length"), 1);
  await evaluate("Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent.includes('No model fixture')&&b.textContent.includes('Доступно:')).click()");
  await until(() => evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1'))?.configuration.flowers.length===2"), "Failed and absent models must remain in composition");
  await clickText("Добавить в корзину");
  const incomplete = await until(() => evaluate("JSON.parse(localStorage.getItem('lotus-cart')||'[]').find(i=>i.configuration?.flowers.some(f=>f.flowerId==='9223372036854775702'))"), "Missing models must still reach the cart");
  assert.equal(incomplete.configuration.flowers.length, 2); assert.equal(incomplete.thumbnail, undefined);
  assert.equal(incomplete.unitPrice, 58);
  // React development reports a caught Suspense load error to CDP as well.
  // The intentional 404 must be isolated by the boundary, as verified above.
  const unexpected = errors.filter(e => !e.exception?.description?.includes(`/api/flower-models/${missingAsset}`));
  assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
  console.log("PASS: isolated textured GLB preview, settings, replace/unlink UI, cached independent meshes, pointer selection, map drag, cart thumbnail, saved/legacy viewing and missing/failed model fallback. API persistence is tested separately using temporary tables.");
} catch (error) {
  console.error("UI fixture state:", await evaluate("document.body.innerText.slice(0,2500)").catch(() => "unavailable"));
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await send("Browser.close").catch(() => {}); socket.close(); }
  if (chrome.exitCode === null) await new Promise(resolve => { chrome.once("exit", resolve); setTimeout(() => { chrome.kill(); resolve(); }, 2000).unref(); });
  const resolvedProfile = await realpath(profile);
  assert.equal(dirname(resolvedProfile), await realpath(tmpdir())); assert.ok(basename(resolvedProfile).startsWith("lotus-model-browser-"));
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
  assert.equal(dirname(routeDirectory), resolve("src/app")); assert.equal(basename(routeDirectory), "lotus-model-test-fixture");
  await rm(routeDirectory, { recursive: true, force: true });
}
