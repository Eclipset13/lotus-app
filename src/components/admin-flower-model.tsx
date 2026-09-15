"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL_SETTINGS, MAX_MODEL_BYTES, sanitizeModelSettings, type FlowerModelSettings, type StoredFlowerModel } from "@/lib/flower-model";
import { validateGlb } from "@/lib/glb-validation";
import type { ModelLoadState } from "@/components/bouquet/uploaded-flower-model";

const Preview = dynamic(() => import("@/components/admin-flower-model-preview"), { ssr: false, loading: () => <p>Открываем предпросмотр…</p> });
const button = "min-h-11 rounded-xl border border-[#e4c8c1] px-4 py-2 text-sm font-semibold disabled:opacity-40";
export function AdminFlowerModel({ flowerId, initialModel }: { flowerId: string; initialModel: StoredFlowerModel | null }) {
  const [saved, setSaved] = useState(initialModel);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [settings, setSettings] = useState<FlowerModelSettings>(initialModel?.settings ?? DEFAULT_MODEL_SETTINGS);
  const [state, setState] = useState<ModelLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { xhrRef.current?.abort(); selection.current++; }, []);
  const previewSettings = sanitizeModelSettings(settings) ?? DEFAULT_MODEL_SETTINGS;
  const model = file ? { assetId: "00000000-0000-4000-8000-000000000000", settings: previewSettings } : saved ? { ...saved, settings: previewSettings } : null;
  const changed = !!file || JSON.stringify(settings) !== JSON.stringify(saved?.settings ?? DEFAULT_MODEL_SETTINGS);

  async function choose(selected?: File) {
    if (!selected) return;
    const token = ++selection.current;
    setError(""); setMessage("");
    try {
      if (selected.size > MAX_MODEL_BYTES) throw new Error("Модель должна быть не больше 20 МиБ");
      validateGlb(new Uint8Array(await selected.arrayBuffer()), selected.name);
      if (token !== selection.current) return;
      setFile(selected); setPreviewUrl(URL.createObjectURL(selected)); setSettings(DEFAULT_MODEL_SETTINGS); setState("loading");
    } catch (e) { if (token === selection.current) setError(e instanceof Error ? e.message : "Не удалось прочитать файл"); }
  }
  async function save(method: "POST" | "PATCH" | "DELETE") {
    if (method !== "DELETE" && !sanitizeModelSettings(settings)) { setError("Проверьте настройки: размер 0,01–10, поворот −360°…360°, смещение −10…10"); return; }
    setBusy(true); setError(""); setMessage(""); setProgress(0);
    try {
      const result = await new Promise<{ model: StoredFlowerModel | null }>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhrRef.current = xhr;
        xhr.open(method, `/api/admin/flowers/${flowerId}/model`);
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onerror = () => reject(new Error("Ошибка сети. Ранее сохранённая модель остаётся назначенной"));
        xhr.ontimeout = () => reject(new Error("Сервер не ответил вовремя. Обновите страницу, чтобы проверить сохранение"));
        xhr.onabort = () => reject(new Error("Загрузка отменена"));
        xhr.onload = () => {
          try { const body = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(body); else reject(new Error(body.error ?? "Не удалось сохранить модель")); }
          catch (e) { reject(e instanceof SyntaxError ? new Error("Не удалось получить ответ сервера") : e); }
        };
        if (method === "POST" && file) {
          xhr.setRequestHeader("Content-Type", "model/gltf-binary");
          xhr.setRequestHeader("X-Model-Name", encodeURIComponent(file.name));
          xhr.setRequestHeader("X-Model-Settings", JSON.stringify(settings));
          xhr.send(file);
        } else if (method === "PATCH") { xhr.setRequestHeader("Content-Type", "application/json"); xhr.send(JSON.stringify(settings)); }
        else xhr.send();
      });
      setSaved(result.model); setFile(null); setPreviewUrl(undefined); setSettings(result.model?.settings ?? DEFAULT_MODEL_SETTINGS);
      setMessage(result.model ? "Модель и настройки сохранены" : "Модель убрана. Состав и цена цветка не изменились");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить модель"); }
    finally { setBusy(false); xhrRef.current = null; }
  }
  function updateTuple(key: "rotation" | "offset", axis: number, value: number) {
    setSettings((previous) => { const tuple = [...previous[key]] as [number, number, number]; tuple[axis] = value; return { ...previous, [key]: tuple }; });
  }
  return <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
    <h2 className="font-serif text-2xl">3D-модель</h2>
    <p className="mt-2 text-sm text-[#806e68]">Выберите файл .glb со встроенными текстурами, до 20 МиБ. Модель относится только к этому складскому цветку.</p>
    <input ref={input} type="file" accept=".glb" className="hidden" aria-label="Выбрать модель" disabled={busy} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy} onClick={() => input.current?.click()}>{model ? "Заменить модель" : "Выбрать модель"}</button>
      {(file || saved) && <span className="break-all text-sm">{file?.name ?? saved?.fileName} · {((file?.size ?? saved?.byteLength ?? 0) / 1024 / 1024).toFixed(2)} МиБ</span>}
    </div>
    {model && <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_330px]">
      <div><Preview model={model} previewUrl={previewUrl} onState={setState} /><p className="mt-2 text-sm text-[#806e68]">Потяните мышью для вращения, колесо — приближение. Пересечение осей обозначает точку крепления стебля.</p></div>
      <fieldset disabled={busy} className="space-y-4">
        <p className="text-sm">Размер подобран по габаритам автоматически. Уточните ориентацию и положение стебля вручную. До сохранения изменения видны только здесь.</p>
        <label className="block text-sm">Размер модели<input aria-label="Размер модели" type="number" min="0.01" max="10" step="0.01" value={Number.isFinite(settings.scale) ? settings.scale : ""} onChange={(e) => setSettings({ ...settings, scale: e.target.valueAsNumber })} className="mt-1 block w-full rounded-lg border p-2" /></label>
        {(["rotation", "offset"] as const).map((key) => <div key={key}><p className="text-sm font-semibold">{key === "rotation" ? "Поворот, градусы" : "Смещение от точки крепления"}</p><div className="mt-2 grid grid-cols-3 gap-2">{["X", "Y", "Z"].map((axis, index) => <label key={axis} className="text-sm">{axis}<input aria-label={`${key === "rotation" ? "Поворот" : "Смещение"} ${axis}`} type="number" min={key === "rotation" ? -360 : -10} max={key === "rotation" ? 360 : 10} step={key === "rotation" ? 1 : 0.05} value={Number.isFinite(settings[key][index]) ? Number((settings[key][index] * (key === "rotation" ? 180 / Math.PI : 1)).toFixed(3)) : ""} onChange={(e) => updateTuple(key, index, e.target.valueAsNumber * (key === "rotation" ? Math.PI / 180 : 1))} className="mt-1 w-full rounded-lg border p-2" /></label>)}</div></div>)}
        <button type="button" className={button} onClick={() => setSettings(DEFAULT_MODEL_SETTINGS)}>Сбросить настройки</button>
      </fieldset>
    </div>}
    <div className="mt-4 flex flex-wrap gap-3">
      {model && <button className={`${button} bg-[#342622] text-white`} disabled={busy || state !== "ready" || !changed} onClick={() => void save(file ? "POST" : "PATCH")}>Сохранить модель</button>}
      {saved && <button className={button} disabled={busy} onClick={() => void save("DELETE")}>Убрать модель</button>}
      {changed && <button className={button} disabled={busy} onClick={() => { selection.current++; setFile(null); setPreviewUrl(undefined); setSettings(saved?.settings ?? DEFAULT_MODEL_SETTINGS); setError(""); }}>Отменить изменения</button>}
    </div>
    {busy && <p role="status" className="mt-3 text-sm">{progress < 100 ? `Загрузка: ${progress}%` : "Проверяем и сохраняем модель…"}</p>}
    {state === "error" && model && <p className="mt-3 text-sm text-red-700">Не удалось открыть модель. Выберите другой GLB. Ранее сохранённая модель не изменена.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-700">{message}</p>}
  </section>;
}
