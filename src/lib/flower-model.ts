/** Public, immutable visual reference. Never contains a filesystem path. */
export type FlowerModelSettings = {
  scale: number;
  rotation: [number, number, number];
  offset: [number, number, number];
};
export type FlowerModel = { assetId: string; settings: FlowerModelSettings };
export type StoredFlowerModel = FlowerModel & { fileName: string; byteLength: number };
export const MAX_MODEL_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MODEL_SETTINGS: FlowerModelSettings = { scale: 1, rotation: [0, 0, 0], offset: [0, 0, 0] };
export const MODEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function tuple(value: unknown, limit: number): [number, number, number] | null {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit)
    ? [value[0], value[1], value[2]] : null;
}
export function sanitizeModelSettings(value: unknown): FlowerModelSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as FlowerModelSettings;
  const rotation = tuple(v.rotation, Math.PI * 2);
  const offset = tuple(v.offset, 10);
  return typeof v.scale === "number" && Number.isFinite(v.scale) && v.scale >= 0.01 && v.scale <= 10 && rotation && offset
    ? { scale: v.scale, rotation, offset } : null;
}
export function sanitizeFlowerModel(value: unknown): FlowerModel | null {
  if (!value || typeof value !== "object") return null;
  const v = value as FlowerModel;
  const settings = sanitizeModelSettings(v.settings);
  return typeof v.assetId === "string" && MODEL_ID_PATTERN.test(v.assetId) && settings ? { assetId: v.assetId, settings } : null;
}
export function sanitizeStoredFlowerModel(value: unknown): StoredFlowerModel | null {
  const model = sanitizeFlowerModel(value);
  const v = value as StoredFlowerModel | null;
  return model && v && typeof v.fileName === "string" && v.fileName.length <= 255 && Number.isInteger(v.byteLength) && v.byteLength > 0 && v.byteLength <= MAX_MODEL_BYTES
    ? { ...model, fileName: v.fileName, byteLength: v.byteLength } : null;
}
export function flowerModelUrl(model: FlowerModel): string { return `/api/flower-models/${model.assetId}`; }
