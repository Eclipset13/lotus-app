"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { UploadedFlowerModel, type ModelLoadState } from "@/components/bouquet/uploaded-flower-model";
import type { FlowerModel } from "@/lib/flower-model";

export default function AdminFlowerModelPreview({ model, previewUrl, onState }: { model: FlowerModel; previewUrl?: string; onState: (state: ModelLoadState) => void }) {
  return <div className="h-[420px] overflow-hidden rounded-2xl bg-[#fff4f1]" aria-label="Предпросмотр 3D-модели">
    <Canvas camera={{ position: [4, 3, 6], fov: 40 }} dpr={[1, 1.5]}>
      <ambientLight intensity={1.7} />
      <directionalLight position={[4, 6, 4]} intensity={2.5} />
      <directionalLight position={[-4, 3, -2]} intensity={1.5} />
      <UploadedFlowerModel model={model} previewUrl={previewUrl} onState={onState} />
      <gridHelper args={[6, 12, "#c49689", "#e5ccc4"]} />
      <axesHelper args={[0.35]} />
      <OrbitControls makeDefault target={[0, 1.3, 0]} minDistance={0.3} maxDistance={40} />
    </Canvas>
  </div>;
}
