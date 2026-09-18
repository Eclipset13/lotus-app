// All database writes use session-local temporary tables; files use isolated temporary directories.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import nextEnv from "@next/env";
import { loadTs } from "./helpers/load-ts.mjs";

const actor = "00000000-0000-4000-8000-000000000001";
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, String(value)); return data; };
const wrappingValues = (overrides = {}) => form({ slug: "linen", name: "Льняная", subtitle: "Мягкая", color: "#abcdef", ribbon_color: "#123456", sale_price: "12,50", opacity: "0,625", sort_order: "40", ...overrides });

async function temporaryClient(sql) {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query(sql);
  return client;
}

test("wrapping migration is idempotent, constrained, seeded and grants minimal CRUD", () => {
  const source = readFileSync("src/db/migrations/20260917_constructor_wrappings.sql", "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.constructor_wrappings/);
  assert.match(source, /ON CONFLICT \(slug\) DO NOTHING/);
  for (const slug of ["blush", "kraft", "ivory"]) assert.match(source, new RegExp(`'${slug}'`));
  assert.match(source, /numeric\(12,2\)/); assert.match(source, /opacity >= 0 AND opacity <= 1/);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.doesNotMatch(source, /DROP TABLE|TRUNCATE|ON CONFLICT[\s\S]*DO UPDATE/i);
});

test("wrapping CRUD is permission checked, transactional, audited and no-op safe", async () => {
  const client = await temporaryClient(`
    CREATE TEMP TABLE constructor_wrappings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, slug text UNIQUE,
      name text,subtitle text,color text,ribbon_color text,sale_price numeric,opacity numeric,sort_order int,
      is_active boolean,has_been_active boolean,updated_at timestamptz DEFAULT now());
    CREATE TEMP TABLE order_items (custom_configuration jsonb);
    CREATE TEMP TABLE admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY,actor_user_id uuid,action text,entity_id text,details jsonb);
  `);
  let allowed = true, touches = 0;
  const query = (sql, values) => { touches++; return client.query(sql.replaceAll("public.", "pg_temp."), values); };
  const actions = loadTs("src/app/admin/wrappings/actions.ts", {
    "@/lib/db": { db: { connect: async () => ({ query, release() {} }) } },
    "@/lib/admin-auth": { requirePermission: async () => { if (!allowed) throw Object.assign(new Error("forbidden"), { status: 403 }); return { userId: actor }; } },
    "next/cache": { revalidatePath() {} },
  });
  try {
    allowed = false; const beforeTouches = touches;
    await assert.rejects(actions.createWrapping({}, wrappingValues()), (error) => error.status === 403);
    assert.equal(touches, beforeTouches);
    allowed = true;
    assert.equal((await actions.createWrapping({}, wrappingValues())).error, "");
    const row = (await client.query("SELECT * FROM pg_temp.constructor_wrappings")).rows[0];
    assert.equal(row.sale_price, "12.50"); assert.equal(row.opacity, "0.625"); assert.equal(row.is_active, false);
    assert.equal((await actions.updateWrapping(String(row.id), {}, wrappingValues())).error, "");
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.admin_audit_log")).rows[0].n, 1, "no-op update must not audit");
    assert.equal((await actions.updateWrapping(String(row.id), {}, wrappingValues({ name: "Лён" }))).error, "");
    assert.equal((await actions.setWrappingActivity(String(row.id), {}, form({ is_active: "true" }))).error, "");
    assert.match((await actions.deleteWrapping(String(row.id), {}, new FormData())).error, /Сначала отключите/);
    await actions.setWrappingActivity(String(row.id), {}, form({ is_active: "false" }));
    assert.match((await actions.deleteWrapping(String(row.id), {}, new FormData())).error, /корзинах или заказах/);
    await actions.createWrapping({}, wrappingValues({ slug: "paper", name: "Бумажная" }));
    const paper = (await client.query("SELECT id::text FROM pg_temp.constructor_wrappings WHERE slug='paper'")).rows[0];
    assert.equal((await actions.deleteWrapping(paper.id, {}, new FormData())).error, "");
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.constructor_wrappings WHERE slug='paper'")).rows[0].n, 0);
    assert.deepEqual((await client.query("SELECT action FROM pg_temp.admin_audit_log ORDER BY id")).rows.map((r) => r.action), [
      "wrapping.create", "wrapping.update", "wrapping.activity", "wrapping.activity", "wrapping.create", "wrapping.delete",
    ]);
  } finally { await client.end(); }
});

test("safe bouquet deletion blocks active/history, rolls back failures and is repeat-safe", async () => {
  const client = await temporaryClient(`
    CREATE TEMP TABLE bouquets (id bigint PRIMARY KEY,name text,is_active boolean);
    CREATE TEMP TABLE bouquet_items (bouquet_id bigint,flower_id bigint,quantity int);
    CREATE TEMP TABLE order_items (bouquet_id bigint);
    CREATE TEMP TABLE admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY,actor_user_id uuid,action text,entity_id text,details jsonb);
    INSERT INTO bouquets VALUES (1,'Активный',true),(2,'Исторический',false),(3,'Удаляемый',false),(4,'Rollback',false);
    INSERT INTO bouquet_items VALUES (2,10,1),(3,10,1),(4,10,1);
    INSERT INTO order_items VALUES (2);
  `);
  let allowed = true, failAudit = false, touches = 0;
  const query = (sql, values) => { touches++; if (failAudit && /INSERT INTO public\.admin_audit_log/.test(sql)) throw new Error("audit failure"); return client.query(sql.replaceAll("public.", "pg_temp."), values); };
  const products = loadTs("src/app/admin/products/actions.ts", {
    "@/lib/db": { db: { connect: async () => ({ query, release() {} }) } },
    "@/lib/admin-auth": { requirePermission: async () => { if (!allowed) throw Object.assign(new Error("forbidden"), { status: 403 }); return { userId: actor }; } },
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } },
  });
  try {
    allowed = false; const before = touches;
    await assert.rejects(products.deleteProduct("3", {}, new FormData()), (error) => error.status === 403); assert.equal(touches, before);
    allowed = true;
    assert.match((await products.deleteProduct("1", {}, new FormData())).error, /скройте/);
    assert.match((await products.deleteProduct("2", {}, new FormData())).error, /заказе/);
    failAudit = true; assert.match((await products.deleteProduct("4", {}, new FormData())).error, /Не удалось/); failAudit = false;
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.bouquets WHERE id=4")).rows[0].n, 1);
    await assert.rejects(products.deleteProduct("3", {}, new FormData()), (error) => error.url === "/admin/products");
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.bouquets WHERE id=3")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.bouquet_items WHERE bouquet_id=3")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.admin_audit_log WHERE action='bouquet.delete'")).rows[0].n, 1);
    assert.match((await products.deleteProduct("3", {}, new FormData())).error, /уже удалён/);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_temp.admin_audit_log WHERE action='bouquet.delete'")).rows[0].n, 1);
  } finally { await client.end(); }
});

function png() { return Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,...Array(16).fill(0)]); }
function jpeg() { return Uint8Array.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0xff,0xd9]); }
function webp() { const b = new Uint8Array(20); b.set(Buffer.from("RIFF"),0); b[4]=12; b.set(Buffer.from("WEBPVP8X"),8); return b; }

test("product images validate signatures, isolate paths, preserve/remove URLs and serve safely", async () => {
  const image = loadTs("src/lib/product-image.ts");
  assert.equal(image.detectProductImage(png()).contentType, "image/png");
  assert.equal(image.detectProductImage(jpeg()).contentType, "image/jpeg");
  assert.equal(image.detectProductImage(webp()).contentType, "image/webp");
  assert.equal(image.detectProductImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  for (const bytes of [png(), jpeg(), webp()]) {
    const parsed = await image.readProductImage({ size: bytes.length, name: "forged.svg", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    assert.ok(parsed?.format.contentType.startsWith("image/"));
  }
  const invalidBytes = Uint8Array.from(Buffer.from("not png!"));
  await assert.rejects(image.readProductImage({ size: invalidBytes.length, name: "fake.png", arrayBuffer: async () => invalidBytes.buffer }), /PNG, JPEG и WebP/);
  await assert.rejects(image.readProductImage({ size: image.MAX_PRODUCT_IMAGE_BYTES + 1, name: "large.png", arrayBuffer: async () => new ArrayBuffer(0) }), /10 МиБ/);

  const root = await mkdtemp(path.join(tmpdir(), "lotus-image-test-"));
  const storage = loadTs("src/lib/product-image-storage.ts", {}, { process: { cwd: () => root } });
  try {
    assert.throws(() => storage.productImageFilePath("../secret"));
    const id = await storage.writeProductImageFile(png());
    const route = loadTs("src/app/api/product-images/[assetId]/route.ts", { "@/lib/product-image-storage": storage });
    const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ assetId: id }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.match(response.headers.get("cache-control"), /immutable/);
    assert.equal((await route.GET(new Request("http://localhost"), { params: Promise.resolve({ assetId: "../secret" }) })).status, 404);
    assert.equal((await readdir(storage.PRODUCT_IMAGE_DIRECTORY)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }

  const imageForm = loadTs("src/lib/product-image-form.ts", { "@/lib/product-image-storage": { writeProductImageFile: async () => { throw new Error("disk failure"); } } });
  const unchanged = await imageForm.prepareProductImage(form({ image_url: "https://example.test/old.jpg" }), "https://example.test/old.jpg");
  assert.equal(unchanged.imageUrl, "https://example.test/old.jpg"); assert.equal(unchanged.source, "unchanged");
  const removed = await imageForm.prepareProductImage(form({ remove_image: "true" }), "https://example.test/old.jpg");
  assert.equal(removed.imageUrl, null); assert.equal(removed.source, "removed");
  const uploadEntry = { size: png().length, name: "photo.svg", arrayBuffer: async () => png().buffer };
  const uploadWins = await imageForm.prepareProductImage({ get: (key) => key === "image_file" ? uploadEntry : "javascript:bad" }, null);
  assert.equal(uploadWins.source, "upload");
  await assert.rejects(imageForm.stageProductImage({ upload: { bytes: png(), format: image.detectProductImage(png()) }, imageUrl: null, source: "upload" }), /disk failure/);

  let writes = 0;
  const protectedActions = loadTs("src/app/admin/products/actions.ts", {
    "@/lib/admin-auth": { requirePermission: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } },
    "@/lib/product-image-storage": { writeProductImageFile: async () => { writes++; }, discardProductImageFile: async () => {} },
  });
  await assert.rejects(protectedActions.createProduct({}, new FormData()), (error) => error.status === 403);
  assert.equal(writes, 0, "authorization runs before file processing");
});
