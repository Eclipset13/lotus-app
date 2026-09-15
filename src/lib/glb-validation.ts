import { MAX_MODEL_BYTES } from "@/lib/flower-model";

export class ModelInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const invalid = () => new ModelInputError("Файл повреждён или содержит некорректную модель GLB");
type Obj = Record<string, unknown>;
function object(v: unknown): Obj { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v as Obj; }
function list(v: unknown): unknown[] { if (!Array.isArray(v)) throw invalid(); return v; }
function integer(v: unknown, min = 0): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) throw invalid(); return v; }
function ref(items: unknown[], index: unknown): Obj { return object(items[integer(index)]); }
function numbers(v: unknown, length: number) {
  if (!Array.isArray(v) || v.length !== length || !v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e10)) throw invalid();
}
// Only extensions handled by the installed GLTFLoader without external decoders.
const supportedExtensions = new Set([
  "KHR_materials_unlit", "KHR_materials_clearcoat", "KHR_materials_transmission",
  "KHR_materials_ior", "KHR_materials_specular", "KHR_materials_sheen",
  "KHR_materials_volume", "KHR_materials_emissive_strength", "KHR_materials_iridescence",
  "KHR_materials_anisotropy", "KHR_texture_transform", "KHR_materials_dispersion",
]);

/** Validate the GLB container and the static, self-contained glTF subset we render. */
export function validateGlb(bytes: Uint8Array, fileName: string): void {
  if (!/\.glb$/i.test(fileName)) throw new ModelInputError("Выберите файл .glb со встроенными текстурами");
  if (bytes.byteLength > MAX_MODEL_BYTES) throw new ModelInputError("Модель должна быть не больше 20 МиБ", 413);
  if (bytes.byteLength < 28) throw invalid();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2 || data.getUint32(8, true) !== bytes.byteLength) throw invalid();
  let json: Obj | undefined;
  let binary: Uint8Array | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw invalid();
    const length = data.getUint32(offset, true), type = data.getUint32(offset + 4, true);
    if (length % 4 || !length || offset + 8 + length > bytes.length) throw invalid();
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 12 && type === 0x4e4f534a) {
      try { json = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(chunk))); } catch { throw invalid(); }
    } else if (json && !binary && type === 0x004e4942) binary = chunk;
    else throw invalid();
    offset += 8 + length;
  }
  if (!json || !binary || object(json.asset).version !== "2.0") throw invalid();
  if (list(json.animations ?? []).length || list(json.skins ?? []).length) throw new ModelInputError("Экспортируйте статичную модель без анимации");
  if (json.asset && object(json.asset).minVersion && object(json.asset).minVersion !== "2.0") throw invalid();
  for (const extension of [...list(json.extensionsUsed ?? []), ...list(json.extensionsRequired ?? [])]) {
    if (typeof extension !== "string" || !supportedExtensions.has(extension)) throw new ModelInputError("Модель использует неподдерживаемое расширение или сжатие. Экспортируйте обычный GLB без Draco, Meshopt и KTX2");
  }
  // Inspect even undeclared extension objects; reject URLs anywhere, including data URIs.
  const pending: Array<{ value: unknown; depth: number }> = [{ value: json, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 64) throw invalid();
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "uri") throw new ModelInputError("Внешние ресурсы не поддерживаются. Встройте текстуры и буферы в GLB");
        if (key === "extensions" && Object.keys(object(item)).some((name) => !supportedExtensions.has(name))) throw new ModelInputError("Расширение модели не поддерживается. Экспортируйте обычный GLB без сжатия");
        pending.push({ value: item, depth: depth + 1 });
      }
    } else if (typeof value === "number" && !Number.isFinite(value)) throw invalid();
  }
  const buffers = list(json.buffers);
  if (buffers.length !== 1) throw invalid();
  const bufferLength = integer(object(buffers[0]).byteLength, 1);
  if (bufferLength > binary.length || binary.length - bufferLength > 3) throw invalid();
  const views = list(json.bufferViews);
  for (const entry of views) {
    const v = object(entry);
    if (v.buffer !== 0 || integer(v.byteOffset ?? 0) + integer(v.byteLength, 1) > bufferLength) throw invalid();
    if (v.byteStride !== undefined && (integer(v.byteStride, 4) > 252 || Number(v.byteStride) % 4)) throw invalid();
  }
  const accessors = list(json.accessors);
  let accessorValues = 0;
  const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  for (const entry of accessors) {
    const a = object(entry);
    if (a.sparse) throw new ModelInputError("Модель использует разреженные данные. Экспортируйте GLB с обычной геометрией");
    const view = ref(views, a.bufferView), count = integer(a.count, 1);
    const size = sizes[Number(a.componentType)], width = widths[String(a.type)];
    if (!size || !width || count > 2_000_000) throw invalid();
    accessorValues += count * width;
    if (accessorValues > 8_000_000) throw new ModelInputError("Слишком сложная модель. Упростите геометрию");
    const offset = integer(a.byteOffset ?? 0), stride = Number(view.byteStride ?? size * width);
    if (stride < size * width || stride % size || offset % size || (Number(view.byteOffset ?? 0) + offset) % size || offset + (count - 1) * stride + size * width > Number(view.byteLength)) throw invalid();
    if (a.min !== undefined) numbers(a.min, width);
    if (a.max !== undefined) numbers(a.max, width);
  }
  const images = list(json.images ?? []), textures = list(json.textures ?? []), materials = list(json.materials ?? []);
  if (images.length > 64 || textures.length > 128 || materials.length > 1024) throw new ModelInputError("Слишком много текстур или материалов в модели");
  for (const entry of images) {
    const img = object(entry), view = ref(views, img.bufferView);
    const content = binary.subarray(Number(view.byteOffset ?? 0), Number(view.byteOffset ?? 0) + Number(view.byteLength));
    const png = img.mimeType === "image/png" && content.length >= 24 && content[0] === 137 && content[1] === 80 && content[2] === 78 && content[3] === 71;
    const jpeg = img.mimeType === "image/jpeg" && content.length >= 4 && content[0] === 255 && content[1] === 216 && content[2] === 255;
    if (!png && !jpeg) throw new ModelInputError("Поддерживаются встроенные текстуры PNG и JPEG");
    if (png) {
      const d = new DataView(content.buffer, content.byteOffset, content.length);
      if (!d.getUint32(16) || !d.getUint32(20) || d.getUint32(16) > 8192 || d.getUint32(20) > 8192) throw new ModelInputError("Размер текстуры не должен превышать 8192 × 8192");
    } else {
      // Read JPEG frame dimensions before any browser decoder allocates memory.
      let cursor = 2, foundFrame = false;
      while (cursor + 4 <= content.length) {
        if (content[cursor++] !== 255) throw invalid();
        while (content[cursor] === 255) cursor++;
        const marker = content[cursor++];
        if (marker === 0xda || marker === 0xd9) break;
        if (cursor + 2 > content.length) throw invalid();
        const length = content[cursor] * 256 + content[cursor + 1];
        if (length < 2 || cursor + length > content.length) throw invalid();
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          if (length < 8) throw invalid();
          const height = content[cursor + 3] * 256 + content[cursor + 4], width = content[cursor + 5] * 256 + content[cursor + 6];
          if (!width || !height || width > 8192 || height > 8192) throw new ModelInputError("Размер текстуры не должен превышать 8192 × 8192");
          foundFrame = true; break;
        }
        cursor += length;
      }
      if (!foundFrame) throw invalid();
    }
  }
  for (const entry of textures) {
    const t = object(entry); ref(images, t.source);
    if (t.sampler !== undefined) ref(list(json.samplers), t.sampler);
  }
  for (const material of materials) {
    const queue = [object(material)];
    while (queue.length) for (const [key, value] of Object.entries(queue.pop()!)) {
      if (key.endsWith("Texture")) ref(textures, object(value).index);
      if (value && typeof value === "object" && !Array.isArray(value)) queue.push(object(value));
    }
  }
  const meshes = list(json.meshes), nodes = list(json.nodes), scenes = list(json.scenes);
  if (nodes.length > 10_000 || meshes.length > 10_000) throw invalid();
  let triangles = 0;
  const checkedPositions = new Set<unknown>();
  for (const entry of meshes) for (const primitive of list(object(entry).primitives)) {
    const p = object(primitive), attrs = object(p.attributes), position = ref(accessors, attrs.POSITION);
    if (position.type !== "VEC3" || position.componentType !== 5126 || (p.mode !== undefined && p.mode !== 4)) throw new ModelInputError("Модель должна содержать треугольную геометрию");
    for (const [name, index] of Object.entries(attrs)) {
      const attribute = ref(accessors, index);
      if (attribute.count !== position.count) throw invalid();
      if (name === "NORMAL" && (attribute.type !== "VEC3" || attribute.componentType !== 5126)) throw invalid();
      if (name.startsWith("TEXCOORD_") && attribute.type !== "VEC2") throw invalid();
    }
    if (p.material !== undefined) ref(materials, p.material);
    const view = ref(views, position.bufferView), base = Number(view.byteOffset ?? 0) + Number(position.byteOffset ?? 0), stride = Number(view.byteStride ?? 12);
    const binaryData = new DataView(binary.buffer, binary.byteOffset, binary.length);
    if (!checkedPositions.has(attrs.POSITION)) {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < Number(position.count); i++) for (let axis = 0; axis < 3; axis++) {
        const n = binaryData.getFloat32(base + i * stride + axis * 4, true);
        if (!Number.isFinite(n) || Math.abs(n) > 1e10) throw invalid();
        min = Math.min(min, n); max = Math.max(max, n);
      }
      if (min === max) throw new ModelInputError("В модели нет отображаемой геометрии");
      checkedPositions.add(attrs.POSITION);
    }
    let count = Number(position.count);
    let vertexIndex = (index: number) => index;
    if (p.indices !== undefined) {
      const a = ref(accessors, p.indices), v = ref(views, a.bufferView), component = Number(a.componentType);
      if (a.type !== "SCALAR" || ![5121, 5123, 5125].includes(component) || v.byteStride) throw invalid();
      count = Number(a.count);
      vertexIndex = (index: number) => {
        const offset = Number(v.byteOffset ?? 0) + Number(a.byteOffset ?? 0) + index * sizes[component];
        return component === 5121 ? binaryData.getUint8(offset) : component === 5123 ? binaryData.getUint16(offset, true) : binaryData.getUint32(offset, true);
      };
      for (let i = 0; i < count; i++) {
        if (vertexIndex(i) >= Number(position.count)) throw invalid();
      }
    }
    if (count < 3 || count % 3) throw invalid();
    triangles += count / 3;
    if (triangles > 500_000) throw new ModelInputError("Слишком сложная модель. Уменьшите число треугольников до 500 000");
    let hasArea = false;
    for (let i = 0; i < count && !hasArea; i += 3) {
      const a = vertexIndex(i), b = vertexIndex(i + 1), c = vertexIndex(i + 2);
      const ab = [0, 1, 2].map((axis) => binaryData.getFloat32(base + b * stride + axis * 4, true) - binaryData.getFloat32(base + a * stride + axis * 4, true));
      const ac = [0, 1, 2].map((axis) => binaryData.getFloat32(base + c * stride + axis * 4, true) - binaryData.getFloat32(base + a * stride + axis * 4, true));
      hasArea = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) > 0;
    }
    if (!hasArea) throw new ModelInputError("В модели нет отображаемой геометрии");
    if (p.targets) throw new ModelInputError("Экспортируйте статичную модель без деформаций");
  }
  // Acyclic tree with no shared children, and a visible mesh in the default scene.
  const parents = new Set<number>();
  for (const entry of nodes) {
    const node = object(entry);
    for (const [key, length] of [["translation", 3], ["rotation", 4], ["scale", 3], ["matrix", 16]] as const) if (node[key] !== undefined) numbers(node[key], length);
    if (node.matrix && (node.translation || node.rotation || node.scale)) throw invalid();
    if (node.scale && (node.scale as number[]).some((value) => value === 0)) throw invalid();
    if (node.rotation && Math.abs(Math.hypot(...node.rotation as number[]) - 1) > 0.001) throw invalid();
    if (node.skin !== undefined) throw new ModelInputError("Экспортируйте статичную модель без скелетной анимации");
    if (node.mesh !== undefined) ref(meshes, node.mesh);
    for (const child of list(node.children ?? [])) { ref(nodes, child); if (parents.has(Number(child))) throw invalid(); parents.add(Number(child)); }
  }
  let visible = false;
  const selectedScene = integer(json.scene ?? 0);
  ref(scenes, selectedScene);
  const checked = new Set<number>();
  const walk = (index: unknown, trail: Set<number>, active: boolean, depth: number) => {
    const id = integer(index), node = ref(nodes, id);
    if (trail.has(id) || depth > 128) throw invalid();
    trail.add(id); checked.add(id);
    if (active && node.mesh !== undefined && list(ref(meshes, node.mesh).primitives).length) visible = true;
    for (const child of list(node.children ?? [])) walk(child, trail, active, depth + 1);
    trail.delete(id);
  };
  scenes.forEach((s, i) => { for (const root of list(object(s).nodes ?? [])) { if (parents.has(Number(root))) throw invalid(); walk(root, new Set(), i === selectedScene, 0); } });
  nodes.forEach((_, i) => { if (!checked.has(i)) walk(i, new Set(), false, 0); });
  if (!visible || !triangles) throw new ModelInputError("В модели нет отображаемой геометрии");
}

/** Content-Length is only an early hint; the stream itself is always bounded. */
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new ModelInputError("Превышен допустимый размер загрузки", 413);
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ModelInputError("Модель должна быть не больше 20 МиБ", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
