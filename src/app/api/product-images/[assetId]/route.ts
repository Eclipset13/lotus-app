import { open } from "node:fs/promises";
import { detectProductImage, MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_ID_PATTERN } from "@/lib/product-image";
import { productImageFilePath } from "@/lib/product-image-storage";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!PRODUCT_IMAGE_ID_PATTERN.test(assetId)) return new Response(null, { status: 404 });
  try {
    const file = await open(productImageFilePath(assetId), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PRODUCT_IMAGE_BYTES) return new Response(null, { status: 404 });
      const bytes = new Uint8Array(await file.readFile());
      const format = detectProductImage(bytes);
      if (!format) return new Response(null, { status: 404 });
      return new Response(bytes, { headers: {
        "Content-Type": format.contentType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${assetId}.${format.extension}"`,
        "Cross-Origin-Resource-Policy": "same-origin",
      } });
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Product image read failed", error);
    return new Response(null, { status: 404 });
  }
}
