import "server-only";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MODEL_ID_PATTERN } from "@/lib/flower-model";

// Persistent application data, outside the build and source tree.
export const MODEL_DIRECTORY = path.join(process.cwd(), "var", "flower-models");
export function modelFilePath(id: string) {
  if (!MODEL_ID_PATTERN.test(id)) throw new Error("Invalid model asset ID");
  return path.join(MODEL_DIRECTORY, `${id}.glb`);
}
export async function discardModelFile(id: string) {
  await unlink(modelFilePath(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
export async function writeModelFile(bytes: Uint8Array) {
  await mkdir(MODEL_DIRECTORY, { recursive: true });
  const id = randomUUID(), destination = modelFilePath(id), temporary = `${destination}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
    return id;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
