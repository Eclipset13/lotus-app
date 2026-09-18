// Run against `npm run dev -- --port 3108 --hostname 127.0.0.1`.
// Isolated UI fixture and Chrome profile; every API request is blocked. No DB writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const base = process.env.LOTUS_FIXTURE_TEST_URL ?? process.env.LOTUS_TEST_URL ?? "http://127.0.0.1:3108";
const routeDirectory = resolve("src/app/lotus-groups-test-fixture");
await mkdir(routeDirectory);
const profile = await mkdtemp(join(tmpdir(), "lotus-groups-browser-"));
await writeFile(join(routeDirectory,"page.tsx"), `import { BouquetConstructorLoader } from "@/components/bouquet-constructor-loader";
export default async function Page({ searchParams }: { searchParams: Promise<{edit?: string}> }) {
  const {edit} = await searchParams;
  return <main style={{height:"100dvh"}}><BouquetConstructorLoader editCartItemId={edit} legacyLinks={{}} wrappings={[{id:"1",slug:"blush",name:"Пудровая",subtitle:"Нежная",color:"#f4cfc8",ribbonColor:"#b85d70",salePrice:25,opacity:0.5,sortOrder:10}]} flowers={[
    {id:"9223372036854775700",name:"Белая эустома",salePrice:12,availableQuantity:50,color:null,imageUrl:null},
    {id:"9223372036854775701",name:"Белая эустома",salePrice:15,availableQuantity:50,color:null,imageUrl:null}
  ]}/></main>;
}`, {flag:"wx"});
const chrome=spawn(process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",[
  "--headless=new","--remote-debugging-port=0",`--user-data-dir=${profile}`,"--no-first-run","--no-default-browser-check","--use-angle=swiftshader","--enable-unsafe-swiftshader","about:blank",
],{windowsHide:true,stdio:"ignore"});
let socket, sequence=0;
const pending=new Map(),errors=[];
async function until(check,message,timeout=45000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await check();if(value)return value;await delay(120);}throw new Error(message);}
function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},30000);pending.set(id,{resolve:(v)=>{clearTimeout(timeout);resolve(v);},reject:(e)=>{clearTimeout(timeout);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
const clickLabel=(label)=>evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
const clickText=(text)=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
const composition=()=>evaluate("JSON.parse(localStorage.getItem('lotus:bouquet-draft:v1')||'null')?.configuration.flowers");
const group="document.querySelector('[data-flower-group=\"stock:9223372036854775700\"]')";
async function open(edit=""){
  await send("Page.navigate",{url:`${base}/lotus-groups-test-fixture${edit?`?edit=${edit}`:""}`});
  await until(()=>evaluate("Array.from(document.querySelectorAll('aside button')).filter(b=>b.textContent.includes('Доступно:')).length===2"),"Fixture did not render");
  await delay(400);
}
try {
  const port=await until(async()=>{try{return(await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];}catch{return null;}},"Chrome did not start");
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails);const task=pending.get(m.id);if(task){pending.delete(m.id);if(m.error)task.reject(new Error(JSON.stringify(m.error)));else task.resolve(m.result);}};
  await send("Page.enable");await send("Runtime.enable");await send("Network.enable");
  await send("Network.setBlockedURLs",{urls:["*/api/*"]});
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await open();
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Перемешать цветы\"]').disabled"),true);
  for(let n=0;n<10;n++){await evaluate("Array.from(document.querySelectorAll('aside button')).filter(b=>b.textContent.includes('Доступно:'))[0].click()");await delay(60);}
  await until(async()=> (await composition())?.length===10,"Ten additions did not persist");
  assert.equal(await evaluate("document.querySelectorAll('[data-flower-group]').length"),1);
  assert.equal(await evaluate(`${group}.textContent.includes('Белая эустома × 10')`),true);
  await evaluate(`${group}.querySelector('button').click()`);
  assert.equal(await evaluate(`${group}.querySelectorAll('button[aria-pressed]').length`),10);
  const original=await composition();
  await evaluate(`${group}.querySelectorAll('button[aria-pressed]')[3].click()`);
  await until(()=>evaluate(`${group}.querySelectorAll('button[aria-pressed]')[3].getAttribute('aria-pressed')==='true'`),"Instance 4 not selected");
  await clickLabel("Удалить выбранный цветок");
  await until(async()=> (await composition())?.length===9,"Deletion did not decrement group");
  assert.equal((await composition()).some(f=>f.id===original[3].id),false,"Group number must select the corresponding scene instance");
  assert.equal(await evaluate(`${group}.textContent.includes('× 9')`),true);
  await clickLabel("Отменить");await until(async()=> (await composition())?.length===10,"Undo deletion failed");
  await evaluate("Array.from(document.querySelectorAll('aside button')).filter(b=>b.textContent.includes('Доступно:'))[1].click()");
  await until(()=>evaluate("document.querySelectorAll('[data-flower-group]').length===2"),"Same names merged different stock IDs");
  await clickLabel("Удалить выбранный цветок");await until(()=>evaluate("document.querySelectorAll('[data-flower-group]').length===1"),"Empty group did not disappear");
  await until(async()=> (await composition())?.length===10,"Draft after deletion did not settle");
  const auto="Array.from(document.querySelectorAll('p')).find(p=>p.textContent.trim()==='Автокомпозиция').parentElement";
  assert.deepEqual(await evaluate(`Array.from(${auto}.querySelectorAll('button')).map(b=>b.textContent.trim())`),["Перемешать","Распределить ровно"]);
  for(const width of [320,375,768,1440]){
    await send("Emulation.setDeviceMetricsOverride",{width,height:1100,deviceScaleFactor:1,mobile:width<768});
    assert.equal(await evaluate(`Array.from(${auto}.querySelectorAll('button')).every(b=>b.scrollWidth<=b.clientWidth && b.type==='button')`),true,`Button overflow at ${width}`);
  }
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  let cartId;
  for(const operation of ["Перемешать","Распределить ровно"]){
    if(cartId){await open(cartId);await until(()=>evaluate("document.body.textContent.includes('Вы редактируете авторский букет из корзины')"),"Cart edit did not open");}
    // Edits loaded from cart are not written to the independent draft; read scene positions via the map and save.
    if(cartId)await evaluate(`localStorage.setItem('lotus:bouquet-draft:v1',JSON.stringify({configuration:JSON.parse(localStorage.getItem('lotus-cart')).find(i=>i.id===${JSON.stringify(cartId)}).configuration}))`);
    const before=await composition();
    const map=()=>evaluate("document.querySelector('svg[aria-label=\"Интерактивная карта букета, вид сверху\"]').innerHTML");
    const beforeMap=await map();
    await clickText(operation);
    if(!cartId)await until(async()=>JSON.stringify(await composition())!==JSON.stringify(before),"Shuffle did not move flowers");
    await until(async()=>await map()!==beforeMap,"Auto layout did not change scene");
    const afterMap=await map();
    const after=await composition();
    await clickLabel("Отменить");
    if(!cartId)await until(async()=>JSON.stringify(await composition())===JSON.stringify(before),"Undo did not restore coordinates");
    else await until(async()=>await map()===beforeMap,"Even layout undo did not restore scene");
    await clickLabel("Повторить");
    await until(async()=>await map()===afterMap,"Redo did not restore scene");
    await clickText(cartId?"Сохранить изменения":"Добавить в корзину");
    const saved=await until(()=>evaluate("JSON.parse(localStorage.getItem('lotus-cart')||'[]').find(i=>i.itemType==='custom-bouquet')"),"Cart not saved");
    if(!cartId)assert.deepEqual(saved.configuration.flowers,after);
    else await until(()=>evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('lotus-cart'))[0].configuration.flowers)!==${JSON.stringify(JSON.stringify(before))}`),"Even layout did not reach cart");
    assert.equal(saved.configuration.flowers.length,10);cartId=saved.id;
  }
  await open(cartId);
  assert.equal(await evaluate(`${group}.textContent.includes('× 10')`),true);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log("PASS: grouped stock IDs, ten instances, selection/delete/undo, empty group removal, two text buttons at 320/375/768/1440px, shuffle/even undo+redo, cart save and reopen.");
} catch(error){console.error("Fixture:",await evaluate("document.body.innerText.slice(0,2000)").catch(()=>"unavailable"));throw error;}
finally {
  if(socket?.readyState===WebSocket.OPEN){await send("Browser.close").catch(()=>{});socket.close();}
  if(chrome.exitCode===null)await new Promise(resolve=>{chrome.once("exit",resolve);setTimeout(()=>{chrome.kill();resolve();},2000).unref();});
  const resolvedProfile=await realpath(profile);assert.equal(dirname(resolvedProfile),await realpath(tmpdir()));assert.ok(basename(resolvedProfile).startsWith("lotus-groups-browser-"));
  await rm(resolvedProfile,{recursive:true,force:true,maxRetries:4,retryDelay:300});
  assert.equal(dirname(routeDirectory),resolve("src/app"));assert.equal(basename(routeDirectory),"lotus-groups-test-fixture");
  await rm(routeDirectory,{recursive:true,force:true});
}
