// Interactive only. Never accept a password in argv, env, a pipe or a file.
import { emitKeypressEvents } from "node:readline";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import pg from "pg";
import nextEnv from "@next/env";
import {
  findActiveSuperAdmin,
  formatDatabaseError,
  setExistingSuperAdminPassword,
} from "./helpers/super-admin-password.mjs";
const require = createRequire(import.meta.url);
function load(file) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, Buffer, Error });
  return exports;
}
const { normalizePhone } = load("src/lib/phone.ts");
const { hashPassword, verifyPassword } = load("src/lib/password.ts");
const phone = normalizePhone(process.argv[2]);
if (!phone || process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Usage: npm run staff:password -- "+992XXXXXXXXX" (interactive terminal required)');
  process.exit(1);
}
async function hiddenPrompt(label) {
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    }
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === "c") return finish(new Error("Cancelled"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = [...value].slice(0, -1).join(""); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text) && value.length + text.length <= 128) value += text;
    }
    process.stdin.on("keypress", onKey);
  });
}
nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  if (!await findActiveSuperAdmin(client, phone)) {
    throw new Error("An active existing super_admin with this phone is required");
  }
  let password = await hiddenPrompt("New personal password (12-128 characters): ");
  let confirmation = await hiddenPrompt("Repeat password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");
  let hash = await hashPassword(password);
  if (!await verifyPassword(password, hash)) throw new Error("Password verification failed");
  password = "";
  confirmation = "";
  await setExistingSuperAdminPassword(client, { phone, passwordHash: hash });
  hash = "";
  console.log("Personal password set and verified; previous sessions revoked. Sign in with your phone.");
} catch (error) {
  // Never print the error object, detail, query or parameters: they may contain credentials.
  console.error(error && typeof error === "object" && "code" in error
    ? formatDatabaseError(error)
    : error instanceof Error ? error.message : "Password setup failed");
  process.exitCode = 1;
} finally { await client.end(); }
