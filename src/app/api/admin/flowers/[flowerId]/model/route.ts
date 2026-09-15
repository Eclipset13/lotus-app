import { revalidatePath } from "next/cache";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { isFlowerId } from "@/lib/bouquet";
import { MAX_MODEL_BYTES, sanitizeModelSettings, sanitizeStoredFlowerModel, type StoredFlowerModel } from "@/lib/flower-model";
import { ModelInputError, readLimitedBody, validateGlb } from "@/lib/glb-validation";
import { discardModelFile, writeModelFile } from "@/lib/flower-model-storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ flowerId: string }> };

async function changeModel(request: Request, context: Context) {
  let stagedAsset: string | undefined;
  let committed = false;
  let commitStarted = false;
  try {
    if (!await isAdminAuthenticated()) return Response.json({ error: "Требуется вход администратора" }, { status: 401 });
    // Cookie authentication requires same-origin protection for ALL mutations.
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "Запрос отклонён. Обновите страницу" }, { status: 403 });
    }
    const { flowerId } = await context.params;
    if (!isFlowerId(flowerId)) throw new ModelInputError("Цветок не найден", 404);
    const exists = await db.query("SELECT id FROM public.flowers WHERE id = $1::bigint", [flowerId]);
    if (!exists.rows.length) throw new ModelInputError("Цветок не найден", 404);

    let uploaded: StoredFlowerModel | undefined;
    let settings;
    if (request.method === "POST") {
      let name: string;
      try {
        name = decodeURIComponent(request.headers.get("x-model-name") ?? "");
        settings = sanitizeModelSettings(JSON.parse(request.headers.get("x-model-settings") ?? "null"));
      } catch { throw new ModelInputError("Проверьте имя файла и настройки модели"); }
      if (!settings) throw new ModelInputError("Проверьте размер, поворот и смещение модели");
      if (!name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw new ModelInputError("Некорректное имя файла");
      const bytes = await readLimitedBody(request, MAX_MODEL_BYTES);
      validateGlb(bytes, name);
      stagedAsset = await writeModelFile(bytes);
      // The supplied filename is display text only, never a filesystem path.
      uploaded = { assetId: stagedAsset, settings, fileName: name.split(/[\\/]/).pop()!, byteLength: bytes.length };
    } else if (request.method === "PATCH") {
      try { settings = sanitizeModelSettings(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096)))); }
      catch (error) { if (error instanceof ModelInputError) throw error; throw new ModelInputError("Некорректные настройки модели"); }
      if (!settings) throw new ModelInputError("Проверьте размер, поворот и смещение модели");
    }

    const client = await db.connect();
    let model: StoredFlowerModel | null = null;
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT model_3d FROM public.flowers WHERE id = $1::bigint FOR UPDATE", [flowerId]);
      if (!result.rows.length) throw new ModelInputError("Цветок не найден", 404);
      if (uploaded) model = uploaded;
      else if (request.method === "PATCH") {
        const previous = sanitizeStoredFlowerModel(result.rows[0].model_3d);
        if (!previous) throw new ModelInputError("Сначала выберите и сохраните модель");
        model = { ...previous, settings: settings! };
      }
      await client.query("UPDATE public.flowers SET model_3d = $2::jsonb, updated_at = now() WHERE id = $1::bigint", [flowerId, model ? JSON.stringify(model) : null]);
      commitStarted = true;
      await client.query("COMMIT");
      committed = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    // Old assets are deliberately retained: order snapshots may reference them.
    revalidatePath(`/admin/inventory/${flowerId}`);
    revalidatePath("/bouquet-builder");
    return Response.json({ model });
  } catch (error) {
    // A connection failure during COMMIT has an uncertain outcome: retain the
    // immutable asset rather than risk deleting a successfully committed file.
    if (stagedAsset && !committed && !commitStarted) await discardModelFile(stagedAsset).catch((cleanupError) => console.error("Model cleanup failed", cleanupError));
    if (error instanceof ModelInputError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Flower model mutation failed", error);
    if ((error as { code?: string }).code === "42703") return Response.json({ error: "Хранение моделей ещё не настроено. Примените миграцию 20260914_flower_models.sql" }, { status: 503 });
    return Response.json({ error: "Не удалось сохранить модель. Попробуйте ещё раз" }, { status: 500 });
  }
}
export const POST = changeModel;
export const PATCH = changeModel;
export const DELETE = changeModel;
