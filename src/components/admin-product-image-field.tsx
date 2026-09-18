"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function AdminProductImageField({ currentUrl }: { currentUrl: string | null }) {
  const [preview, setPreview] = useState(currentUrl ?? "");
  const [temporary, setTemporary] = useState("");
  const [remove, setRemove] = useState(false);
  useEffect(() => () => { if (temporary) URL.revokeObjectURL(temporary); }, [temporary]);
  return <div className="space-y-4">
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">Ссылка на фотографию
      <input name="image_url" type="url" maxLength={2000} defaultValue={currentUrl ?? ""} placeholder="https://…" onChange={(event) => { if (!temporary && !remove) setPreview(event.target.value); }} className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25" />
    </label>
    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">Или загрузить с компьютера
      <input name="image_file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
        if (temporary) URL.revokeObjectURL(temporary);
        const file = event.target.files?.[0];
        const next = file ? URL.createObjectURL(file) : "";
        setTemporary(next); setPreview(next || (remove ? "" : currentUrl ?? ""));
      }} className="mt-2 block w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3 text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[#342622] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white" />
      <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-[#99817a]">PNG, JPEG или WebP, максимум 10 МиБ. Новый файл важнее ссылки.</span>
    </label>
    {preview && <div className="relative h-44 overflow-hidden rounded-2xl border border-[#ead8d1] bg-[#fff4f1]"><Image src={preview} alt="Предпросмотр фотографии" fill unoptimized sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" /></div>}
    {currentUrl && <label className="flex items-center gap-3 text-sm font-semibold text-[#765b54]"><input type="checkbox" name="remove_image" value="true" checked={remove} onChange={(event) => { setRemove(event.target.checked); if (!temporary) setPreview(event.target.checked ? "" : currentUrl); }} className="h-4 w-4 accent-[#b85d70]" />Удалить текущую привязку</label>}
  </div>;
}
