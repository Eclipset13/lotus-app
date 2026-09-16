import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);
export function loadTs(file, overrides = {}, globals = {}, cache = new Map()) {
  let path = resolve(file);
  if (!existsSync(path)) path += existsSync(`${path}.ts`) ? ".ts" : ".tsx";
  if (cache.has(path)) return cache.get(path);
  const exports = {}; cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  runInNewContext(code, { exports, console, process, Buffer, Error, Request, Response, URL, FormData,
    TextDecoder, Uint8Array, structuredClone, ...globals,
    require(name) {
      if (name in overrides) return overrides[name];
      if (name === "server-only") return {};
      if (overrides.__stubComponents && name.startsWith("@/components/")) return new Proxy({}, { get: () => () => null });
      if (name.startsWith("@/")) return loadTs(`src/${name.slice(2)}`, overrides, globals, cache);
      if (name.startsWith(".")) return loadTs(resolve(dirname(path), name), overrides, globals, cache);
      return nativeRequire(name);
    },
  });
  return exports;
}
