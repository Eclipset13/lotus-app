// All database writes use temporary tables; uploaded test files use an isolated temp directory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import pg from "pg";
import nextEnv from "@next/env";
import { technicalGlb } from "./fixtures/technical-glb.mjs";

const require = createRequire(import.meta.url);
function loadTs(file, overrides = {}, globals = {}, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved);
  const exports = {}; cache.set(resolved, exports);
  const code = ts.transpileModule(readFileSync(resolved, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, {
    exports, console, process, Error, Request, Response, URL, TextDecoder, Uint8Array, DataView, ...globals,
    require(name) {
      if (name in overrides) return overrides[name];
      if (name === "server-only") return {};
      if (name.startsWith("@/")) return loadTs(`src/${name.slice(2)}.ts`, overrides, globals, cache);
      return require(name);
    },
  });
  return exports;
}
const validation = loadTs("src/lib/glb-validation.ts");
const models = loadTs("src/lib/flower-model.ts");
const settings = structuredClone(models.DEFAULT_MODEL_SETTINGS);

test("GLB structure, embedded resources, geometry and settings are validated", () => {
  validation.validateGlb(technicalGlb(), "fixture.GLB");
  validation.validateGlb(technicalGlb(undefined, true), "textured.glb");
  for (const mutate of [
    (g) => { g.asset.version = "1.0"; },
    (g) => { g.buffers[0].uri = "https://example.invalid/remote.bin"; },
    (g) => { g.images = [{ uri: "../secret.png" }]; },
    (g) => { g.extensionsRequired = ["KHR_draco_mesh_compression"]; },
    (g) => { g.meshes[0].primitives[0].extensions = { EXT_meshopt_compression: {} }; },
    (g) => { g.bufferViews[0].byteLength = 5000; },
    (g) => { g.accessors[0].count = 4; },
    (g) => { g.nodes[0].children = [0]; },
    (g) => { g.scenes[0].nodes = []; },
    (g) => { g.meshes[0].primitives[0].attributes.POSITION = 8; },
    (g) => { g.meshes[0].primitives[0].material = 5; },
    (g) => { g.nodes[0].translation = [0, "bad", 0]; },
  ]) assert.throws(() => validation.validateGlb(technicalGlb(mutate), "fixture.glb"));
  const valid = technicalGlb();
  for (const offset of [0, 4, 8, 12, 16]) {
    const corrupt = Buffer.from(valid); corrupt.writeUInt32LE(7, offset);
    assert.throws(() => validation.validateGlb(corrupt, "fixture.glb"));
  }
  const nonFinite = Buffer.from(valid); nonFinite.writeFloatLE(NaN, nonFinite.length - 4);
  assert.throws(() => validation.validateGlb(nonFinite, "fixture.glb"));
  assert.throws(() => validation.validateGlb(valid.subarray(0, -1), "fixture.glb"));
  assert.throws(() => validation.validateGlb(valid, "fixture.exe"));
  assert.throws(() => validation.validateGlb(new Uint8Array(models.MAX_MODEL_BYTES + 1), "fixture.glb"), (e) => e.status === 413);
  assert.equal(models.sanitizeModelSettings({ ...settings, scale: NaN }), null);
  assert.equal(models.sanitizeModelSettings({ ...settings, offset: [0, 11, 0] }), null);
  assert.equal(models.sanitizeModelSettings({ ...settings, rotation: [0, 7, 0] }), null);
  assert.equal(models.sanitizeFlowerModel({ assetId: "../../secret", settings }), null);
  assert.ok(models.sanitizeModelSettings({ scale: 0.7, rotation: [0, Math.PI, 0], offset: [1, -1, 0] }));
});

test("actual streamed byte count is bounded even when Content-Length lies or is absent", async () => {
  for (const contentLength of [undefined, "1"]) {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(12)); }, cancel() { cancelled = true; } });
    const request = new Request("http://localhost/test", { method: "POST", body, duplex: "half", headers: contentLength ? { "content-length": contentLength } : {} });
    await assert.rejects(validation.readLimitedBody(request, 20), (e) => e.status === 413);
    assert.equal(cancelled, true);
  }
});

test("authorized upload/settings/replacement/unlink, rollback cleanup, immutable order references and public serving", async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  const root = await mkdtemp(path.join(tmpdir(), "lotus-model-test-"));
  const storage = loadTs("src/lib/flower-model-storage.ts", {}, { process: { cwd: () => root } });
  let authenticated = true, failUpdate = false, touches = 0;
  const logs = [];
  await client.connect();
  try {
    await client.query("CREATE TEMP TABLE flowers (id bigint, model_3d jsonb, updated_at timestamptz); INSERT INTO flowers(id) VALUES (1)");
    const migration = readFileSync("src/db/migrations/20260914_flower_models.sql", "utf8").replaceAll("public.", "pg_temp.");
    await client.query(migration); await client.query(migration);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM flowers")).rows[0].n, 1);
    const query = async (sql, values) => {
      touches++;
      if (failUpdate && sql.startsWith("UPDATE")) throw new Error("Simulated database failure");
      return client.query(sql.replaceAll("public.", "pg_temp."), values);
    };
    const paths = [];
    const overrides = {
      "@/lib/admin-auth": { authorizeApi: async () => authenticated ? ({ userId: "00000000-0000-0000-0000-000000000001", roles: ["super_admin"] }) : Response.json({ message: "Требуется вход" }, { status: 401 }) },
      "@/lib/db": { db: { query, connect: async () => ({ query, release() {} }) } },
      "@/lib/flower-model-storage": storage,
      "next/cache": { revalidatePath: (p) => paths.push(p) },
    };
    const route = loadTs("src/app/api/admin/flowers/[flowerId]/model/route.ts", overrides, { console: { error: (...args) => logs.push(args) } });
    const get = loadTs("src/app/api/flower-models/[assetId]/route.ts", overrides).GET;
    const call = (method, { id = "1", origin = "http://localhost", body, name = "тест.glb", display = settings } = {}) => route[method](new Request("http://localhost/api/admin/flowers/1/model", {
      method, headers: { origin, "x-model-name": encodeURIComponent(name), "x-model-settings": JSON.stringify(display) },
      body: method === "POST" ? body ?? technicalGlb() : method === "PATCH" ? body ?? JSON.stringify(display) : undefined,
    }), { params: Promise.resolve({ flowerId: id }) });
    authenticated = false;
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await call(method)).status, 401);
    assert.equal(touches, 0);
    authenticated = true;
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await call(method, { origin: "https://attacker.invalid" })).status, 403);
    assert.equal(touches, 0);
    assert.equal((await call("POST", { id: "2" })).status, 404);
    assert.equal((await call("POST", { body: Buffer.from("damaged") })).status, 400);
    assert.equal((await call("POST", { body: new Uint8Array(models.MAX_MODEL_BYTES + 1) })).status, 413);
    const response = await call("POST"); assert.equal(response.status, 200);
    const first = (await response.json()).model;
    assert.deepEqual((await client.query("SELECT model_3d FROM flowers")).rows[0].model_3d, first);
    assert.equal(first.fileName, "тест.glb");
    assert.deepEqual(paths, ["/admin/inventory/1", "/bouquet-builder"]);
    const served = await get(new Request("http://localhost"), { params: Promise.resolve({ assetId: first.assetId }) });
    assert.equal(served.status, 200); assert.match(served.headers.get("cache-control"), /immutable/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), technicalGlb());
    assert.equal((await get(new Request("http://localhost"), { params: Promise.resolve({ assetId: "../secret" }) })).status, 404);
    const changed = { scale: 1.7, rotation: [0.4, -1, 0], offset: [0, 0.5, -0.2] };
    assert.equal((await call("PATCH", { display: changed })).status, 200);
    const adjusted = (await client.query("SELECT model_3d FROM flowers")).rows[0].model_3d;
    assert.deepEqual(adjusted.settings, changed); assert.equal(adjusted.assetId, first.assetId);
    assert.equal((await call("PATCH", { display: { ...settings, scale: 100 } })).status, 400);
    const orderSnapshot = models.sanitizeFlowerModel(adjusted);
    failUpdate = true;
    assert.equal((await call("POST")).status, 500);
    failUpdate = false;
    assert.equal((await readdir(storage.MODEL_DIRECTORY)).length, 1, "Failed DB mutation removes the new file");
    assert.deepEqual((await client.query("SELECT model_3d FROM flowers")).rows[0].model_3d, adjusted);
    const second = (await (await call("POST", { name: "replacement.glb" })).json()).model;
    assert.notEqual(second.assetId, first.assetId);
    assert.equal((await readdir(storage.MODEL_DIRECTORY)).length, 2);
    assert.equal((await call("DELETE")).status, 200);
    assert.equal((await client.query("SELECT model_3d FROM flowers")).rows[0].model_3d, null);
    assert.equal((await readdir(storage.MODEL_DIRECTORY)).length, 2, "Unlink never removes files used by saved orders");
    assert.equal(orderSnapshot.assetId, first.assetId); assert.deepEqual(JSON.parse(JSON.stringify(orderSnapshot.settings)), changed);
    assert.equal((await get(new Request("http://localhost"), { params: Promise.resolve({ assetId: orderSnapshot.assetId }) })).status, 200);
    const brokenStorage = { ...storage, writeModelFile: async () => { throw new Error("Disk unavailable"); } };
    const brokenRoute = loadTs("src/app/api/admin/flowers/[flowerId]/model/route.ts", { ...overrides, "@/lib/flower-model-storage": brokenStorage }, { console: { error() {} } });
    const failure = await brokenRoute.POST(new Request("http://localhost/test", { method: "POST", headers: { origin: "http://localhost", "x-model-name": "test.glb", "x-model-settings": JSON.stringify(settings) }, body: technicalGlb() }), { params: Promise.resolve({ flowerId: "1" }) });
    assert.equal(failure.status, 500);
    assert.equal((await client.query("SELECT model_3d FROM flowers")).rows[0].model_3d, null);
    assert.equal(logs.length, 1);
  } finally {
    await client.end();
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("lotus-model-test-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("server visual snapshots override client models; cart and old configurations preserve compatibility", () => {
  const bouquet = loadTs("src/lib/bouquet.ts");
  const stock = loadTs("src/lib/constructor-stock.ts", { "@/lib/db": { db: {} } });
  const cart = loadTs("src/lib/cart.ts");
  const first = { assetId: "11111111-1111-4111-8111-111111111111", settings };
  const fake = { assetId: "22222222-2222-4222-8222-222222222222", settings: { ...settings, scale: 5 } };
  const config = { schemaVersion: 2, wrappingKind: "blush", flowers: [0, 1].map((i) => ({ id: `instance-${i}`, flowerId: "1", position: [i, 0, 0], rotation: [0, i, 0], snapshot: { name: "Forged", salePrice: 0, model: fake } })) };
  const flowers = [{ id: "1", name: "Stock flower", salePrice: 50, availableQuantity: 10, color: null, imageUrl: null, model: first }];
  const verified = stock.verifyCustomBouquet(bouquet.sanitizeCustomBouquetConfig(config), flowers, {});
  assert.equal(JSON.stringify(verified.flowers[0].snapshot.model), JSON.stringify(first));
  assert.equal(bouquet.calculateCustomBouquetPrice(verified), 125);
  const old = { schemaVersion: 1, wrappingKind: "blush", flowers: [{ id: "legacy", kind: "rose", position: [0, 0, 0], rotation: [0, 0, 0] }] };
  const items = cart.sanitizeCartItems([{ id: "v2", itemType: "custom-bouquet", unitPrice: 125, quantity: 1, configuration: verified }, { id: "v1", itemType: "custom-bouquet", unitPrice: 999, quantity: 1, configuration: old }]);
  const restored = cart.sanitizeCartItems(JSON.parse(JSON.stringify(items)));
  assert.deepEqual(JSON.parse(JSON.stringify(restored[0].configuration)), JSON.parse(JSON.stringify(verified)));
  assert.equal(restored[1].configuration.schemaVersion, 1); assert.equal(restored[1].unitPrice, 999);
  flowers[0].model = fake;
  assert.equal(verified.flowers[0].snapshot.model.assetId, first.assetId);
  flowers[0].model = null;
  assert.equal(stock.verifyCustomBouquet(config, flowers, {}).flowers[0].snapshot.model, null);
});
