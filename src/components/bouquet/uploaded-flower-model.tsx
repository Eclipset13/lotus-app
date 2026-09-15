"use client";

import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useLoader } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import { GLTFLoader, SkeletonUtils } from "three-stdlib";
import { flowerModelUrl, type FlowerModel, type FlowerModelSettings } from "@/lib/flower-model";

export type ModelLoadState = "loading" | "ready" | "error";
function ModelState({ state, onState }: { state: ModelLoadState; onState?: (state: ModelLoadState) => void }) {
  useEffect(() => { onState?.(state); }, [state, onState]);
  return <group userData={{ modelStatus: state }}>
    {state !== "ready" && <Html position={[0, 2, 0]} center style={{ pointerEvents: "none", width: 180 }}>
      <p className="rounded-xl bg-white/95 p-2 text-center text-xs text-[#765b54]">{state === "error" ? "Не удалось загрузить 3D-модель. Цветок доступен на схеме" : "Загружаем 3D-модель…"}</p>
    </Html>}
  </group>;
}
class ModelBoundary extends Component<{ children: ReactNode; onState?: (state: ModelLoadState) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <ModelState state="error" onState={this.props.onState} /> : this.props.children; }
}

/** Clone scene objects, sharing immutable geometry/materials/textures from useLoader's URL cache. */
function LoadedModel({ url, settings, onState }: { url: string; settings: FlowerModelSettings; onState?: (state: ModelLoadState) => void }) {
  const gltf = useLoader(GLTFLoader, url);
  const { instance, factor, origin } = useMemo(() => {
    const instance = SkeletonUtils.clone(gltf.scene);
    instance.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(instance), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error("Model has empty bounds");
    instance.traverse((object) => { object.castShadow = true; object.receiveShadow = true; });
    return { instance, factor: 3.05 / extent, origin: [-center.x, -bounds.min.y, -center.z] as [number, number, number] };
  }, [gltf.scene]);
  return <group dispose={null} userData={{ modelStatus: "ready" }}>
    <ModelState state="ready" onState={onState} />
    <group position={settings.offset} rotation={settings.rotation} scale={settings.scale}>
      <group scale={factor}><group position={origin}><primitive object={instance} dispose={null} /></group></group>
    </group>
  </group>;
}

export function UploadedFlowerModel({ model, previewUrl, onState }: { model: FlowerModel; previewUrl?: string; onState?: (state: ModelLoadState) => void }) {
  const url = previewUrl ?? flowerModelUrl(model);
  return <ModelBoundary key={url} onState={onState}>
    <Suspense fallback={<ModelState state="loading" onState={onState} />}>
      <LoadedModel url={url} settings={model.settings} onState={onState} />
    </Suspense>
  </ModelBoundary>;
}
