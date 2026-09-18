import "server-only";
import { ProductImageInputError, productImageUrl, readProductImage } from "@/lib/product-image";
import { writeProductImageFile } from "@/lib/product-image-storage";

export type PreparedProductImage = {
  upload: Awaited<ReturnType<typeof readProductImage>>;
  imageUrl: string | null;
  source: "upload" | "external" | "removed" | "unchanged";
};

export async function prepareProductImage(formData: FormData, currentUrl: string | null): Promise<PreparedProductImage> {
  const upload = await readProductImage(formData.get("image_file"));
  if (upload) return { upload, imageUrl: currentUrl, source: "upload" };
  if (formData.get("remove_image") === "true") return { upload: null, imageUrl: null, source: currentUrl ? "removed" : "unchanged" };
  const raw = String(formData.get("image_url") ?? "").trim();
  if (!raw) return { upload: null, imageUrl: currentUrl, source: "unchanged" };
  if (raw === currentUrl) return { upload: null, imageUrl: currentUrl, source: "unchanged" };
  if (raw.length > 2000 || /[\x00-\x1f\x7f]/.test(raw)) throw new ProductImageInputError("URL фотографии содержит недопустимые символы");
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("..") && !raw.includes("\\")) {
    return { upload: null, imageUrl: raw, source: "external" };
  }
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch { throw new ProductImageInputError("URL фотографии должен начинаться с http:// или https://"); }
  return { upload: null, imageUrl: raw, source: raw === currentUrl ? "unchanged" : "external" };
}

export async function stageProductImage(prepared: PreparedProductImage) {
  if (!prepared.upload) return { assetId: null, imageUrl: prepared.imageUrl, source: prepared.source };
  const assetId = await writeProductImageFile(prepared.upload.bytes);
  return { assetId, imageUrl: productImageUrl(assetId), source: "upload" as const };
}
