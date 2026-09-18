import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import { PRODUCT_IMAGE_ID_PATTERN } from "@/lib/product-image";

export const PRODUCT_IMAGE_DIRECTORY = path.join(process.cwd(), "var", "product-images");
export function productImageFilePath(id: string) {
  if (!PRODUCT_IMAGE_ID_PATTERN.test(id)) throw new Error("Invalid product image ID");
  return path.join(PRODUCT_IMAGE_DIRECTORY, `${id}.img`);
}
export async function discardProductImageFile(id: string) {
  await unlink(productImageFilePath(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
export async function writeProductImageFile(bytes: Uint8Array) {
  await mkdir(PRODUCT_IMAGE_DIRECTORY, { recursive: true });
  const id = randomUUID();
  const destination = productImageFilePath(id);
  const temporary = `${destination}.tmp`;
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
