"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import {
  PerspectiveCamera,
  type Camera,
  type WebGLRenderer,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { BouquetTopViewMap } from "@/components/bouquet-top-view-map";
import {
  BouquetVisualScene,
  getBouquetCameraPosition,
} from "@/components/bouquet/bouquet-visual-scene";
import {
  CUSTOM_BOUQUET_WRAPPINGS,
  type CustomBouquetConfig,
} from "@/lib/bouquet";
import { getBouquetRadius } from "@/lib/bouquet-layout";

type AdminBouquetViewerCanvasProps = {
  configuration: CustomBouquetConfig;
  viewMode: "3d" | "top";
};

export default function AdminBouquetViewerCanvas({
  configuration,
  viewMode,
}: AdminBouquetViewerCanvasProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const sceneHostRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const wrapping = CUSTOM_BOUQUET_WRAPPINGS.find(
    (option) => option.kind === configuration.wrappingKind,
  );
  const cameraPosition = useMemo(
    () => getBouquetCameraPosition(configuration.flowers),
    [configuration.flowers],
  );
  const bouquetRadius = useMemo(
    () => getBouquetRadius(configuration.flowers),
    [configuration.flowers],
  );

  const connectRenderer = useCallback(
    ({ gl, camera }: { gl: WebGLRenderer; camera: Camera }) => {
      const host = sceneHostRef.current;
      if (!host) return;

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        gl.setSize(width, height, false);
        gl.domElement.style.width = "100%";
        gl.domElement.style.height = "100%";

        if (camera instanceof PerspectiveCamera) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
      };

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = new ResizeObserver(resize);
      resizeObserverRef.current.observe(host);
      resize();
      gl.domElement.dataset.bouquetSceneReady = "true";
    },
    [],
  );

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    },
    [],
  );

  if (!wrapping) return null;

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden rounded-[24px] border border-[#edd8d2] bg-[#fff4f1]"
      style={{ minHeight: "inherit" }}
    >
      {configuration.flowers.some((flower) => !flower.kind && !flower.snapshot?.model) && viewMode === "3d" && (
        <p className="absolute left-3 right-3 top-3 z-20 rounded-xl bg-white/95 p-3 text-sm">
          3D-модель этого цветка пока не добавлена. Полный состав и расположение доступны на карте «Вид сверху».
        </p>
      )}
      <div
        ref={sceneHostRef}
        className={`absolute inset-0 transition-opacity ${
          viewMode === "3d" ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={viewMode !== "3d"}
      >
        <Canvas
          shadows="basic"
          dpr={[1, 1.6]}
          camera={{ position: cameraPosition, fov: 40 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={connectRenderer}
          className="cursor-grab active:cursor-grabbing"
        >
          <BouquetVisualScene
            flowers={configuration.flowers}
            wrapping={wrapping}
            controlsRef={controlsRef}
            readonly
            cameraPosition={cameraPosition}
          />
        </Canvas>
      </div>

      {viewMode === "top" && (
        <div className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-[#fff4f1] p-3 sm:p-6">
          <BouquetTopViewMap
            flowers={configuration.flowers}
            bouquetRadius={bouquetRadius}
            readonly
            standalone
          />
        </div>
      )}

      {viewMode === "3d" && (
        <button
          type="button"
          onClick={() => controlsRef.current?.reset()}
          className="absolute bottom-3 right-3 z-20 min-h-11 rounded-full border border-[#e4c8c1] bg-white/90 px-4 text-sm font-semibold text-[#765b54] shadow-sm backdrop-blur transition hover:bg-white hover:text-[#a85265] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] sm:bottom-4 sm:right-4"
        >
          Сбросить вид
        </button>
      )}
    </div>
  );
}
