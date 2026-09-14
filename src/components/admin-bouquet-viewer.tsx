"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  formatCustomBouquetComposition,
  type CustomBouquetConfig,
  type CustomBouquetSummary,
} from "@/lib/bouquet";

const AdminBouquetViewerCanvas = dynamic(
  () => import("@/components/admin-bouquet-viewer-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-[55dvh] place-items-center rounded-[24px] bg-[#fff4f1] text-sm font-semibold text-[#9a756d]">
        Загружаем 3D-просмотр…
      </div>
    ),
  },
);

type ViewerSelection = {
  configuration: CustomBouquetConfig;
  summary: CustomBouquetSummary;
  itemLabel: string;
};

type ViewerContextValue = {
  openViewer: (selection: ViewerSelection, trigger: HTMLButtonElement) => void;
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function AdminBouquetViewerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [active, setActive] = useState<ViewerSelection | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "top">("3d");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const closeViewer = useCallback(() => {
    setActive(null);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
      triggerRef.current = null;
    });
  }, []);

  const openViewer = useCallback(
    (selection: ViewerSelection, trigger: HTMLButtonElement) => {
      triggerRef.current = trigger;
      setViewMode(selection.configuration.schemaVersion === 2 ? "top" : "3d");
      setActive(selection);
    },
    [],
  );

  useEffect(() => {
    if (!active) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, closeViewer]);

  return (
    <ViewerContext.Provider value={{ openViewer }}>
      {children}

      {active && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-[#2f211d]/65 p-0 backdrop-blur-sm sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-bouquet-viewer-title"
            aria-describedby="admin-bouquet-viewer-description"
            className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[#fffdfc] shadow-[0_35px_100px_rgba(35,22,18,0.4)] sm:h-[min(760px,calc(100dvh-32px))] sm:w-[min(1100px,92vw)] sm:rounded-[32px] sm:border sm:border-[#ead5cf]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eddcd6] bg-white px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#b27670]">
                  {active.itemLabel}
                </p>
                <h2
                  id="admin-bouquet-viewer-title"
                  className="mt-1 font-serif text-2xl text-[#3f2c27] sm:text-3xl"
                >
                  Авторский букет
                </h2>
                <p
                  id="admin-bouquet-viewer-description"
                  className="mt-1 line-clamp-2 text-xs leading-5 text-[#806e68] sm:text-sm"
                >
                  {formatCustomBouquetComposition(active.summary)} · Упаковка: {active.summary.wrappingName}
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Закрыть просмотр букета"
                title="Закрыть"
                onClick={closeViewer}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#ead8d2] text-xl text-[#765b54] transition hover:border-[#dc9ba7] hover:bg-[#fff0f1] hover:text-[#ad5265] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#f0e1dc] bg-[#fffaf8] px-4 py-2 sm:px-6">
              <div
                className="inline-flex rounded-full border border-[#e5cbc4] bg-white p-1"
                role="group"
                aria-label="Режим просмотра букета"
              >
                <button
                  type="button"
                  aria-pressed={viewMode === "3d"}
                  onClick={() => setViewMode("3d")}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] ${
                    viewMode === "3d"
                      ? "bg-[#b85d70] text-white shadow-sm"
                      : "text-[#765b54] hover:bg-[#fff1ed]"
                  }`}
                >
                  3D
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "top"}
                  onClick={() => setViewMode("top")}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] ${
                    viewMode === "top"
                      ? "bg-[#b85d70] text-white shadow-sm"
                      : "text-[#765b54] hover:bg-[#fff1ed]"
                  }`}
                >
                  Вид сверху
                </button>
              </div>

              <p className="hidden text-xs text-[#967b74] sm:block">
                {active.summary.totalFlowers} цветов
              </p>
            </div>

            <div
              className="flex-1 overflow-hidden bg-[#fff4f1] p-2 sm:min-h-0 sm:p-4"
              style={{ minHeight: "55dvh" }}
            >
              <AdminBouquetViewerCanvas
                configuration={active.configuration}
                viewMode={viewMode}
              />
            </div>

            <footer className="shrink-0 border-t border-[#eddcd6] bg-white px-4 py-3 text-center text-xs text-[#806e68] sm:px-6 sm:text-sm">
              Потяните, чтобы вращать · колесо — приблизить
            </footer>
          </div>
        </div>
      )}
    </ViewerContext.Provider>
  );
}

export function AdminBouquetViewButton({
  configuration,
  summary,
  itemLabel,
}: {
  configuration: CustomBouquetConfig | null;
  summary: CustomBouquetSummary | null;
  itemLabel: string;
}) {
  const context = useContext(ViewerContext);
  const available = Boolean(configuration && summary && context);

  if (!available || !configuration || !summary || !context) {
    return (
      <div className="mt-3">
        <button
          type="button"
          disabled
          className="min-h-11 cursor-not-allowed rounded-full border border-[#eadbd6] bg-[#f7efec] px-4 text-xs font-semibold text-[#aa9690]"
        >
          Посмотреть букет
        </button>
        <p className="mt-1.5 text-xs text-[#a45d69]">
          Конфигурация недоступна
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={(event) =>
          context.openViewer(
            { configuration, summary, itemLabel },
            event.currentTarget,
          )
        }
        className="min-h-11 rounded-full bg-[#b85d70] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(184,93,112,0.22)] transition hover:bg-[#a84e63] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
      >
        Посмотреть букет
      </button>
      <span className="text-xs text-[#927871]">
        Сохранена индивидуальная композиция
      </span>
    </div>
  );
}
