export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductImageFormat = { contentType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp" };
export class ProductImageInputError extends Error {}

function ascii(bytes: Uint8Array, start: number, text: string) {
  return Array.from(text).every((character, index) => bytes[start + index] === character.charCodeAt(0));
}

export function detectProductImage(bytes: Uint8Array): ProductImageFormat | null {
  if (bytes.length >= 24 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)) {
    return { contentType: "image/png", extension: "png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 20 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") &&
      ["VP8 ", "VP8L", "VP8X"].some((chunk) => ascii(bytes, 12, chunk))) {
    const declared = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
    if ((declared >>> 0) === bytes.length - 8) return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

type UploadedFile = { size: number; name: string; arrayBuffer(): Promise<ArrayBuffer> };
export async function readProductImage(entry: FormDataEntryValue | null) {
  if (!entry || typeof entry === "string") return null;
  const file = entry as unknown as UploadedFile;
  if (file.size === 0 && !file.name) return null;
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new ProductImageInputError("Файл изображения пуст");
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) throw new ProductImageInputError("Изображение должно быть не больше 10 МиБ");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new ProductImageInputError("Некорректный размер изображения");
  const format = detectProductImage(bytes);
  if (!format) throw new ProductImageInputError("Разрешены только PNG, JPEG и WebP. SVG запрещён");
  return { bytes, format };
}

export function productImageUrl(id: string) {
  if (!PRODUCT_IMAGE_ID_PATTERN.test(id)) throw new Error("Invalid product image ID");
  return `/api/product-images/${id}`;
}
