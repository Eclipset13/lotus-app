"use client";

import Image from "next/image";
import { useState } from "react";

export function BouquetImage({ src, name }: { src: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && src !== failedSrc ? (
    <Image src={src} alt={name} fill unoptimized sizes="(max-width: 700px) 100vw, 33vw"
      className="object-cover transition duration-700 group-hover:scale-105"
      onError={() => setFailedSrc(src)} />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-[#f8ece8]">
      <span role="img" aria-label="Фото букета пока нет" className="text-7xl">🌸</span>
    </div>
  );
}
