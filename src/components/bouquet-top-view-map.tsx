"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  FlowerInstance,
  Vector3,
} from "@/lib/bouquet-layout";

const VIEWBOX_SIZE = 200;
const CENTER = VIEWBOX_SIZE / 2;
const MAP_RADIUS = 78;

const MARKER_COLORS: Record<FlowerInstance["kind"], string> = {
  rose: "#d98291",
  peony: "#efb7c2",
  tulip: "#f5d7c9",
};

type BouquetTopViewMapProps = {
  flowers: FlowerInstance[];
  selectedId?: string | null;
  bouquetRadius: number;
  compact?: boolean;
  readonly?: boolean;
  standalone?: boolean;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, position: Vector3) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export function BouquetTopViewMap({
  flowers,
  selectedId = null,
  bouquetRadius,
  compact = false,
  readonly = false,
  standalone = false,
  onSelect,
  onMove,
  onDragStart,
  onDragEnd,
}: BouquetTopViewMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    flowerId: string;
    pointerId: number;
  } | null>(null);
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{
    flowerId: string;
    position: Vector3;
  } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const moveFromPointer = (
    event: ReactPointerEvent<SVGSVGElement>,
    flowerId: string
  ) => {
    if (readonly || !onMove) {
      return;
    }

    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    const bounds = svg.getBoundingClientRect();
    const mapX =
      ((event.clientX - bounds.left) / bounds.width) *
      VIEWBOX_SIZE;
    const mapY =
      ((event.clientY - bounds.top) / bounds.height) *
      VIEWBOX_SIZE;
    const flower = flowers.find((item) => item.id === flowerId);

    if (!flower) {
      return;
    }

    pendingMove.current = {
      flowerId,
      position: [
        ((mapX - CENTER) / MAP_RADIUS) * bouquetRadius,
        flower.position[1],
        ((mapY - CENTER) / MAP_RADIUS) * bouquetRadius,
      ],
    };

    if (moveFrame.current === null) {
      moveFrame.current = window.requestAnimationFrame(() => {
        moveFrame.current = null;

        if (pendingMove.current) {
          onMove(
            pendingMove.current.flowerId,
            pendingMove.current.position
          );
          pendingMove.current = null;
        }
      });
    }
  };

  const finishDragging = (
    event: ReactPointerEvent<SVGSVGElement>
  ) => {
    if (readonly || !onMove) {
      return;
    }

    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (moveFrame.current !== null) {
      window.cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }

    if (pendingMove.current) {
      onMove(
        pendingMove.current.flowerId,
        pendingMove.current.position
      );
      pendingMove.current = null;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
    setDraggedId(null);
    onDragEnd?.();
  };

  useEffect(() => {
    return () => {
      if (moveFrame.current !== null) {
        window.cancelAnimationFrame(moveFrame.current);
      }

      pendingMove.current = null;
    };
  }, []);

  if (collapsed && !readonly && !standalone) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setCollapsed(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute bottom-4 right-4 z-30 min-h-11 rounded-full border border-[#e7c9c3] bg-white/90 px-4 text-sm font-semibold text-[#6f554e] shadow-[0_12px_32px_rgba(74,48,41,0.14)] backdrop-blur-md transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] sm:bottom-5 sm:right-5 lg:bottom-6 lg:right-6"
      >
        Вид сверху
      </button>
    );
  }

  return (
    <div
      className={`${standalone ? "relative mx-auto flex h-full w-full max-w-[620px] flex-col justify-center rounded-[30px]" : `absolute bottom-4 right-4 z-30 rounded-[22px] sm:bottom-5 sm:right-5 sm:w-[210px] lg:bottom-6 lg:right-6 lg:w-[220px] xl:w-[240px] 2xl:w-[260px] ${compact ? "w-[calc(50%-20px)]" : "w-[176px]"}`} border border-[#e9cfc9] bg-white/82 p-3 shadow-[0_18px_48px_rgba(74,48,41,0.14)] backdrop-blur-xl sm:p-4`}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
        <p className="font-serif text-sm text-[#49332d] sm:text-base">
          Вид сверху
        </p>

        <button
          type="button"
          aria-label="Свернуть вид сверху"
          title="Свернуть"
          onClick={() => setCollapsed(true)}
          className={`${readonly || standalone ? "hidden" : "grid"} h-11 w-11 place-items-center rounded-full text-[#8b7069] transition hover:bg-[#fff1ed] hover:text-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] sm:h-9 sm:w-9`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path
              d="M7 12h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        role={readonly ? "img" : "group"}
        aria-label={
          readonly
            ? "Расположение цветов в букете, вид сверху"
            : "Интерактивная карта букета, вид сверху"
        }
        className={`aspect-square max-h-full w-full select-none rounded-full ${
          flowers.length && !readonly ? "cursor-crosshair" : "cursor-default"
        }`}
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          event.stopPropagation();

          if (!readonly && !dragRef.current && flowers.length) {
            onSelect?.(null);
          }
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          if (readonly) return;
          const drag = dragRef.current;

          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }

          moveFromPointer(event, drag.flowerId);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (!readonly) finishDragging(event);
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          if (!readonly) finishDragging(event);
        }}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={MAP_RADIUS}
          fill="#fffaf8"
          stroke="#dcb6ae"
          strokeWidth="1.4"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={MAP_RADIUS * 0.66}
          fill="none"
          stroke="#ead9d4"
          strokeWidth="0.8"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={MAP_RADIUS * 0.34}
          fill="none"
          stroke="#f0e2de"
          strokeWidth="0.7"
        />
        <circle cx={CENTER} cy={CENTER} r="2.2" fill="#c98b80" opacity="0.65" />

        {!flowers.length && (
          <text
            x={CENTER}
            y={CENTER + 18}
            textAnchor="middle"
            fill="#9b817b"
            fontSize="11"
          >
            Добавьте цветы
          </text>
        )}

        {flowers.map((flower, index) => {
          const markerX =
            CENTER +
            (flower.position[0] / bouquetRadius) * MAP_RADIUS;
          const markerY =
            CENTER +
            (flower.position[2] / bouquetRadius) * MAP_RADIUS;
          const selected = flower.id === selectedId;
          const dragged = flower.id === draggedId;

          return (
            <g
              key={flower.id}
              transform={`translate(${markerX} ${markerY})`}
              className={readonly ? "cursor-default" : dragged ? "cursor-grabbing" : "cursor-grab"}
              role={readonly ? undefined : "button"}
              aria-label={readonly ? undefined : `Выбрать цветок ${index + 1}`}
              tabIndex={readonly ? undefined : 0}
              onKeyDown={(event) => {
                if (readonly) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(flower.id);
                }
              }}
              onPointerDown={(event) => {
                if (readonly) return;
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(flower.id);
                dragRef.current = {
                  flowerId: flower.id,
                  pointerId: event.pointerId,
                };
                setDraggedId(flower.id);
                svgRef.current?.setPointerCapture(event.pointerId);
                onDragStart?.();
              }}
            >
              {selected && (
                <circle
                  r="14"
                  fill="none"
                  stroke="#b85d70"
                  strokeWidth="1.8"
                  opacity="0.9"
                />
              )}
              <circle
                r={dragged ? 10.5 : 9.5}
                fill={MARKER_COLORS[flower.kind]}
                stroke={selected ? "#8f4052" : "#ffffff"}
                strokeWidth={selected ? 2.4 : 1.8}
                className="transition-[r]"
              />
              <text
                x="0"
                y="3.3"
                textAnchor="middle"
                fill={flower.kind === "tulip" ? "#775d55" : "#ffffff"}
                fontSize="8.5"
                fontWeight="700"
                pointerEvents="none"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
