import { open } from "node:fs/promises";
import { MODEL_ID_PATTERN, MAX_MODEL_BYTES } from "@/lib/flower-model";
import { modelFilePath } from "@/lib/flower-model-storage";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!MODEL_ID_PATTERN.test(assetId)) return new Response(null, { status: 404 });
  try {
    const file = await open(modelFilePath(assetId), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_MODEL_BYTES) return new Response(null, { status: 404 });
      const bytes = await file.readFile();
      return new Response(bytes, { headers: {
        "Content-Type": "model/gltf-binary", "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${assetId}.glb"`, "Cross-Origin-Resource-Policy": "same-origin",
      } });
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Model file read failed", error);
    return new Response(null, { status: 404 });
  }
}
