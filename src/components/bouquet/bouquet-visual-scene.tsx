"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  DoubleSide,
  Vector3 as ThreeVector3,
  type Group,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { CUSTOM_BOUQUET_WRAPPINGS } from "@/lib/bouquet";
import {
  FLOWER_HEAD_OFFSET,
  getBouquetRadius,
  type FlowerInstance,
  type FlowerKind,
  type Vector3,
} from "@/lib/bouquet-layout";

export type BouquetWrappingOption =
  (typeof CUSTOM_BOUQUET_WRAPPINGS)[number];

type FlowerStyle = {
  outerCount: number;
  innerCount: number;
  outerColor: string;
  innerColor: string;
  coreColor: string;
  outerRadius: number;
  innerRadius: number;
  outerScale: Vector3;
  innerScale: Vector3;
  coreScale: Vector3;
  outerTilt: number;
  innerTilt: number;
};

const FLOWER_STYLES: Record<FlowerKind, FlowerStyle> = {
  rose: {
    outerCount: 11,
    innerCount: 8,
    outerColor: "#d98291",
    innerColor: "#bf6477",
    coreColor: "#a94e63",
    outerRadius: 0.21,
    innerRadius: 0.1,
    outerScale: [0.17, 0.1, 0.31],
    innerScale: [0.12, 0.12, 0.22],
    coreScale: [0.13, 0.13, 0.13],
    outerTilt: 0.42,
    innerTilt: 0.28,
  },
  peony: {
    outerCount: 16,
    innerCount: 12,
    outerColor: "#efb7c2",
    innerColor: "#dc8fa0",
    coreColor: "#c86f84",
    outerRadius: 0.24,
    innerRadius: 0.12,
    outerScale: [0.2, 0.11, 0.32],
    innerScale: [0.14, 0.13, 0.23],
    coreScale: [0.15, 0.15, 0.15],
    outerTilt: 0.5,
    innerTilt: 0.35,
  },
  tulip: {
    outerCount: 6,
    innerCount: 0,
    outerColor: "#f5d7c9",
    innerColor: "#f5d7c9",
    coreColor: "#eebda9",
    outerRadius: 0.11,
    innerRadius: 0,
    outerScale: [0.18, 0.37, 0.13],
    innerScale: [0, 0, 0],
    coreScale: [0.19, 0.28, 0.19],
    outerTilt: 0.24,
    innerTilt: 0,
  },
};

const WRAPPING_TOP_Y = 0.52;
const DEFAULT_CAMERA_POSITION: Vector3 = [0, 2.8, 7.2];
const DEFAULT_CAMERA_TARGET: Vector3 = [0, -0.25, 0];

export function getBouquetCameraPosition(
  flowers: FlowerInstance[],
): Vector3 {
  const radius = getBouquetRadius(flowers);
  const horizontalSpread = Math.max(
    radius,
    ...flowers.map((flower) =>
      Math.hypot(flower.position[0], flower.position[2]),
    ),
  );
  const highestFlower = Math.max(
    0,
    ...flowers.map((flower) => flower.position[1]),
  );
  const distance = Math.max(
    6.6,
    6.45 + horizontalSpread * 0.72 + highestFlower * 0.2,
  );

  return [0, 2.65 + Math.min(0.35, highestFlower * 0.16), distance];
}

function PetalRing({
  count,
  radius,
  y,
  color,
  scale,
  tilt,
  offset = 0,
}: {
  count: number;
  radius: number;
  y: number;
  color: string;
  scale: Vector3;
  tilt: number;
  offset?: number;
}) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + offset;

    return (
      <mesh
        key={index}
        position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]}
        rotation={[0.1, -angle, tilt]}
        scale={scale}
        castShadow
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.52} />
      </mesh>
    );
  });
}

export function FlowerModel({ kind }: { kind: FlowerKind }) {
  const style = FLOWER_STYLES[kind];

  return (
    <group>
      <mesh position={[0, -0.66, 0]} castShadow>
        <cylinderGeometry args={[0.027, 0.04, 2.98, 10]} />
        <meshStandardMaterial color="#577a54" roughness={0.75} />
      </mesh>

      <mesh
        position={[0.11, -0.35, 0]}
        rotation={[0.1, 0, -0.55]}
        scale={[0.13, 0.38, 0.055]}
        castShadow
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#73946d" roughness={0.8} />
      </mesh>

      <group position={[0, 0.9, 0]}>
        <PetalRing
          count={style.outerCount}
          radius={style.outerRadius}
          y={kind === "tulip" ? 0.08 : 0}
          color={style.outerColor}
          scale={style.outerScale}
          tilt={style.outerTilt}
        />

        {style.innerCount > 0 && (
          <PetalRing
            count={style.innerCount}
            radius={style.innerRadius}
            y={0.09}
            color={style.innerColor}
            scale={style.innerScale}
            tilt={style.innerTilt}
            offset={0.22}
          />
        )}

        <mesh
          position={[0, kind === "tulip" ? 0.05 : 0.14, 0]}
          scale={style.coreScale}
          castShadow
        >
          <sphereGeometry args={[1, 18, 14]} />
          <meshStandardMaterial color={style.coreColor} roughness={0.52} />
        </mesh>
      </group>
    </group>
  );
}

function AnimatedFlower({
  flower,
  selected,
  readonly,
  onSelect,
  onMove,
  onDragChange,
}: {
  flower: FlowerInstance;
  selected: boolean;
  readonly: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: Vector3) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const group = useRef<Group>(null);
  const flowerPivot = useRef<Group>(null);
  const progress = useRef(0);
  const { camera } = useThree();
  const moveFrame = useRef<number | null>(null);
  const pendingPosition = useRef<Vector3 | null>(null);
  const dragStart = useRef<{
    clientX: number;
    clientY: number;
    position: Vector3;
    right: ThreeVector3;
    forward: ThreeVector3;
  } | null>(null);

  useFrame((_, delta) => {
    if (!group.current || !flowerPivot.current) return;

    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta * 2.2);
    }

    const eased = 1 - Math.pow(1 - progress.current, 3);
    group.current.scale.setScalar(Math.max(0.001, eased));
    group.current.position.set(
      flower.position[0],
      flower.position[1] - (1 - eased) * 1.4,
      flower.position[2],
    );
    flowerPivot.current.rotation.set(...flower.rotation);
  });

  const startDragging = (event: ThreeEvent<PointerEvent>) => {
    if (readonly || !onSelect || !onDragChange) return;

    event.stopPropagation();
    onSelect(flower.id);

    const forward = new ThreeVector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new ThreeVector3()
      .crossVectors(forward, new ThreeVector3(0, 1, 0))
      .normalize();

    dragStart.current = {
      clientX: event.nativeEvent.clientX,
      clientY: event.nativeEvent.clientY,
      position: [...flower.position],
      right,
      forward,
    };

    onDragChange(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (readonly) return;

    const moveFlower = (event: PointerEvent) => {
      const start = dragStart.current;
      if (!start || !onMove) return;

      const sensitivity = 0.0048;
      const deltaX = event.clientX - start.clientX;
      const deltaY = event.clientY - start.clientY;
      pendingPosition.current = [
        start.position[0] +
          start.right.x * deltaX * sensitivity -
          start.forward.x * deltaY * sensitivity,
        start.position[1],
        start.position[2] +
          start.right.z * deltaX * sensitivity -
          start.forward.z * deltaY * sensitivity,
      ];

      if (moveFrame.current === null) {
        moveFrame.current = window.requestAnimationFrame(() => {
          moveFrame.current = null;
          if (pendingPosition.current && onMove) {
            onMove(flower.id, pendingPosition.current);
            pendingPosition.current = null;
          }
        });
      }
    };

    const stopDragging = () => {
      if (!dragStart.current) return;

      if (moveFrame.current !== null) {
        window.cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
      }
      if (pendingPosition.current && onMove) {
        onMove(flower.id, pendingPosition.current);
        pendingPosition.current = null;
      }

      dragStart.current = null;
      onDragChange?.(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", moveFlower);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", moveFlower);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      if (moveFrame.current !== null) {
        window.cancelAnimationFrame(moveFrame.current);
      }
      pendingPosition.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [flower.id, onDragChange, onMove, readonly]);

  return (
    <group
      ref={group}
      name={`flower-instance-${flower.id}`}
      userData={{ instanceId: flower.id, flowerId: flower.flowerId }}
      position={flower.position}
      scale={0.001}
      onPointerDown={readonly ? undefined : startDragging}
      onPointerEnter={
        readonly
          ? undefined
          : () => {
              if (!dragStart.current) document.body.style.cursor = "grab";
            }
      }
      onPointerLeave={
        readonly
          ? undefined
          : () => {
              if (!dragStart.current) document.body.style.cursor = "";
            }
      }
    >
      {selected && !readonly && (
        <mesh
          position={[0, FLOWER_HEAD_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={10}
        >
          <ringGeometry args={[0.36, 0.43, 48]} />
          <meshBasicMaterial
            color="#b85d70"
            transparent
            opacity={0.9}
            depthTest={false}
          />
        </mesh>
      )}

      <group
        ref={flowerPivot}
        position={[0, FLOWER_HEAD_OFFSET, 0]}
        rotation={flower.rotation}
      >
        <group position={[0, -FLOWER_HEAD_OFFSET, 0]}>
          {flower.kind && <FlowerModel kind={flower.kind} />}
        </group>
      </group>
    </group>
  );
}

export type BouquetVisualSceneProps = {
  flowers: FlowerInstance[];
  wrapping: BouquetWrappingOption;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  readonly?: boolean;
  selectedId?: string | null;
  isDragging?: boolean;
  hideSelection?: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: Vector3) => void;
  onDragChange?: (dragging: boolean) => void;
  cameraPosition?: Vector3;
  cameraTarget?: Vector3;
};

export function BouquetVisualScene({
  flowers,
  wrapping,
  controlsRef,
  readonly = false,
  selectedId = null,
  isDragging = false,
  hideSelection = false,
  onSelect,
  onMove,
  onDragChange,
  cameraPosition = DEFAULT_CAMERA_POSITION,
  cameraTarget = DEFAULT_CAMERA_TARGET,
}: BouquetVisualSceneProps) {
  const bouquetRadius = getBouquetRadius(flowers);
  const wrappingBottomRadius = Math.max(0.18, bouquetRadius * 0.28);
  const wrappingHeight = 2.15 + bouquetRadius * 0.25;
  const wrappingCenterY = WRAPPING_TOP_Y - wrappingHeight / 2;
  const [cameraX, cameraY, cameraZ] = cameraPosition;
  const [targetX, targetY, targetZ] = cameraTarget;

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    controls.object.position.set(cameraX, cameraY, cameraZ);
    controls.object.zoom = 1;
    controls.object.updateProjectionMatrix();
    controls.target.set(targetX, targetY, targetZ);
    controls.update();
    controls.saveState();
  }, [cameraX, cameraY, cameraZ, controlsRef, targetX, targetY, targetZ]);

  return (
    <>
      <color attach="background" args={["#fff4f1"]} />
      <fog attach="fog" args={["#fff4f1", 8, 14]} />
      <ambientLight intensity={1.45} />
      <directionalLight
        castShadow
        position={[4, 7, 5]}
        intensity={2.2}
        color="#fff8f2"
      />
      <pointLight position={[-4, 2, 3]} intensity={1.6} color="#ffd6df" />

      <group position={[0, 0.35, 0]}>
        {flowers.map((flower) => (
          <AnimatedFlower
            key={flower.id}
            flower={flower}
            selected={!hideSelection && flower.id === selectedId}
            readonly={readonly}
            onSelect={onSelect}
            onMove={onMove}
            onDragChange={onDragChange}
          />
        ))}

        {flowers.length > 0 && (
          <mesh
            position={[0, wrappingCenterY, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry
              args={[
                bouquetRadius,
                wrappingBottomRadius,
                wrappingHeight,
                48,
                1,
                true,
              ]}
            />
            <meshPhysicalMaterial
              color={wrapping.color}
              roughness={0.78}
              transparent
              opacity={wrapping.opacity}
              side={DoubleSide}
            />
          </mesh>
        )}
      </group>

      <ContactShadows
        position={[0, -2.48, 0]}
        opacity={0.28}
        scale={7}
        blur={2.7}
        far={5}
      />
      <mesh position={[0, -2.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[5.5, 64]} />
        <meshStandardMaterial color="#f8e9e4" roughness={1} />
      </mesh>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isDragging}
        enablePan={false}
        minDistance={4.8}
        maxDistance={10}
        minPolarAngle={0.45}
        maxPolarAngle={1.65}
        target={cameraTarget}
      />
    </>
  );
}
