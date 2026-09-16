"use client";

import Image from "next/image";
import { FlowerInstanceGroups } from "@/components/flower-instance-groups";
import { useRouter } from "next/navigation";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { Canvas } from "@react-three/fiber";

import {
    type Camera,
    type Scene,
    type WebGLRenderer,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { BouquetImage } from "@/components/bouquet-image";
import { BouquetTopViewMap } from "@/components/bouquet-top-view-map";
import { BouquetVisualScene } from "@/components/bouquet/bouquet-visual-scene";
import {
    calculateCustomBouquetPrice,
    createCustomBouquetSummary,
    flowerSnapshot,
    formatCustomBouquetComposition,
    type PublicFlower,
    type LegacyFlowerLinks,
    CUSTOM_BOUQUET_WRAPPINGS,
    MAX_CUSTOM_BOUQUET_FLOWERS,
    sanitizeCustomBouquetConfig,
    type CustomBouquetConfig,
    type WrappingKind,
} from "@/lib/bouquet";
import {
    readCartItems,
    writeCartItems,
    type CustomBouquetCartItem,
} from "@/lib/cart";
import {
    alignStemsToAnchor,
    generateEvenBouquetLayout,
    generateRandomBouquetLayout,
    getBouquetRadius,
    getFlowerBoundaryRadius,
    resolveFlowerCollisions,
    type FlowerInstance,
    type FlowerKind,
    type Vector3,
} from "@/lib/bouquet-layout";

const WRAPPINGS = CUSTOM_BOUQUET_WRAPPINGS;
const MAX_FLOWERS = MAX_CUSTOM_BOUQUET_FLOWERS;
const AUTO_COMPOSITION_HEIGHT_OFFSET = -0.21;
const BOUQUET_DRAFT_KEY = "lotus:bouquet-draft:v1";

function modelsReadyForPreview(scene?: Scene): boolean {
    if (!scene) return false;
    let ready = true;
    scene.traverse((object) => {
        if (object.userData.modelStatus === "loading" || object.userData.modelStatus === "error") ready = false;
    });
    return ready;
}

type BouquetDraft = {
    schemaVersion: 1;
    configuration: CustomBouquetConfig;
    updatedAt: string;
};

type CartSavePhase = "thumbnail" | "saving" | null;

function getPlacement(
    index: number,
    bouquetRadius: number,
    kind?: FlowerKind
) {
    const angle =
        index * Math.PI * (3 - Math.sqrt(5));

    const availableRadius = Math.max(
        0.08,
        bouquetRadius - getFlowerBoundaryRadius(kind) - 0.055
    );

    const radius = Math.min(
        0.3 * Math.sqrt(index),
        availableRadius
    );

    return {
        position: [
            Math.cos(angle) * radius,
            Math.sin(index * 1.7) * 0.08,
            Math.sin(angle) * radius,
        ] as Vector3,

        rotation: [
            Math.sin(angle) * 0.11,
            angle,
            -Math.cos(angle) * 0.11,
        ] as Vector3,
    };
}

function money(value: number) {
    return (
        new Intl.NumberFormat("ru-RU").format(value) +
        " сомони"
    );
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Canvas did not produce an image"));
                }
            },
            type,
            quality
        );
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Image read failed"));
        reader.readAsDataURL(blob);
    });
}

async function createCartThumbnail(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
): Promise<string> {
    renderer.render(scene, camera);
    const sourceBlob = await canvasToBlob(renderer.domElement, "image/png");
    const bitmap = await createImageBitmap(sourceBlob);

    try {
        const maximumSide = 640;
        const scale = Math.min(
            1,
            maximumSide / Math.max(bitmap.width, bitmap.height)
        );
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const thumbnailCanvas = document.createElement("canvas");
        thumbnailCanvas.width = width;
        thumbnailCanvas.height = height;
        const context = thumbnailCanvas.getContext("2d");

        if (!context) {
            throw new Error("2D canvas is unavailable");
        }

        context.drawImage(bitmap, 0, 0, width, height);
        const thumbnailBlob = await canvasToBlob(
            thumbnailCanvas,
            "image/webp",
            0.82
        );

        return blobToDataUrl(thumbnailBlob);
    } finally {
        bitmap.close();
    }
}

function readBouquetDraft(): BouquetDraft | null {
    try {
        const stored = window.localStorage.getItem(BOUQUET_DRAFT_KEY);

        if (!stored) return null;

        const candidate = JSON.parse(stored) as Partial<BouquetDraft>;
        const configuration = sanitizeCustomBouquetConfig(
            candidate.configuration
        );

        if (
            candidate.schemaVersion !== 1 ||
            !configuration ||
            typeof candidate.updatedAt !== "string" ||
            !Number.isFinite(Date.parse(candidate.updatedAt))
        ) {
            window.localStorage.removeItem(BOUQUET_DRAFT_KEY);
            return null;
        }

        return {
            schemaVersion: 1,
            configuration,
            updatedAt: candidate.updatedAt,
        };
    } catch {
        window.localStorage.removeItem(BOUQUET_DRAFT_KEY);
        return null;
    }
}

function createBouquetConfiguration(
    flowers: FlowerInstance[],
    wrappingKind: WrappingKind
): CustomBouquetConfig {
    return {
        schemaVersion: flowers.every((flower) => flower.flowerId) ? 2 : 1,
        flowers: flowers.map((flower) => ({
            ...flower,
            position: [...flower.position],
            rotation: [...flower.rotation],
        })),
        wrappingKind,
    };
}

export function BouquetConstructor({
    editCartItemId,
    stockFlowers,
    legacyLinks,
}: {
    editCartItemId?: string;
    stockFlowers: PublicFlower[];
    legacyLinks: LegacyFlowerLinks;
}) {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [flowers, setFlowers] = useState<
        FlowerInstance[]
    >([]);

    const [wrappingKind, setWrappingKind] =
        useState<WrappingKind>("blush");

    const wrapping =
        WRAPPINGS.find(
            (option) => option.kind === wrappingKind
        ) ?? WRAPPINGS[0];

    const [selectedId, setSelectedId] =
        useState<string | null>(null);

    const [isDragging, setIsDragging] =
        useState(false);

    const [clearDialogOpen, setClearDialogOpen] =
        useState(false);

    const [selectedPanelCollapsed, setSelectedPanelCollapsed] =
        useState(false);

    const [isPreparingPreview, setIsPreparingPreview] =
        useState(false);

    const [previewUrl, setPreviewUrl] =
        useState<string | null>(null);
    const [mapPreviewOpen, setMapPreviewOpen] = useState(false);

    const [previewError, setPreviewError] =
        useState<string | null>(null);

    const [cartSavePhase, setCartSavePhase] =
        useState<CartSavePhase>(null);

    const [cartActionMessage, setCartActionMessage] =
        useState<string | null>(null);

    const [editingItemId, setEditingItemId] =
        useState<string | null>(null);

    const [draftOffer, setDraftOffer] =
        useState<BouquetDraft | null>(null);

    const [storageReady, setStorageReady] =
        useState(false);

    const [historyStatus, setHistoryStatus] = useState({
        canUndo: false,
        canRedo: false,
    });

    const flowersRef = useRef(flowers);
    const interactionStartRef = useRef<FlowerInstance[] | null>(null);
    const historyRef = useRef<{
        past: FlowerInstance[][];
        future: FlowerInstance[][];
    }>({
        past: [],
        future: [],
    });
    const controlsRef = useRef<OrbitControlsImpl | null>(null);
    const renderStateRef = useRef<{
        gl: WebGLRenderer;
        scene: Scene;
        camera: Camera;
    } | null>(null);
    const previewUrlRef = useRef<string | null>(null);
    const previewCapturePendingRef = useRef(false);
    const cartSavePendingRef = useRef(false);
    const storageInitializationRef = useRef(false);
    const mountedRef = useRef(true);
    const clearButtonRef = useRef<HTMLButtonElement>(null);
    const cancelClearButtonRef = useRef<HTMLButtonElement>(null);
    const previewButtonRef = useRef<HTMLButtonElement>(null);
    const previewModalRef = useRef<HTMLDivElement>(null);
    const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
    const draftContinueButtonRef = useRef<HTMLButtonElement>(null);
    const draftDialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        flowersRef.current = flowers;
    }, [flowers]);

    const updateHistoryStatus = useCallback(() => {
        setHistoryStatus({
            canUndo: historyRef.current.past.length > 0,
            canRedo: historyRef.current.future.length > 0,
        });
    }, []);

    const replaceFlowers = useCallback((next: FlowerInstance[]) => {
        flowersRef.current = next;
        setFlowers(next);
    }, []);

    const recordSnapshot = useCallback((snapshot: FlowerInstance[]) => {
        historyRef.current.past = [
            ...historyRef.current.past.slice(-39),
            snapshot,
        ];
        historyRef.current.future = [];
        updateHistoryStatus();
    }, [updateHistoryStatus]);

    const commitFlowerChange = useCallback((
        updater: (current: FlowerInstance[]) => FlowerInstance[]
    ) => {
        const current = flowersRef.current;
        const next = updater(current);

        if (next === current) {
            return;
        }

        recordSnapshot(current);
        replaceFlowers(next);
    }, [recordSnapshot, replaceFlowers]);

    const beginContinuousEdit = useCallback(() => {
        if (!interactionStartRef.current) {
            interactionStartRef.current = flowersRef.current;
        }
    }, []);

    const finishContinuousEdit = useCallback(() => {
        const start = interactionStartRef.current;
        interactionStartRef.current = null;

        if (start && start !== flowersRef.current) {
            recordSnapshot(start);
        }
    }, [recordSnapshot]);

    const cancelContinuousEdit = useCallback(() => {
        interactionStartRef.current = null;
        setIsDragging(false);
    }, []);

    const restoreConfiguration = useCallback((
        configuration: CustomBouquetConfig
    ) => {
        replaceFlowers(
            configuration.flowers.map((flower) => {
                const flowerId = configuration.schemaVersion === 2 ? flower.flowerId : flower.kind && legacyLinks[flower.kind];
                const stock = stockFlowers.find((item) => item.id === flowerId);
                return {
                    ...(flowerId ? { id: flower.id, flowerId, snapshot: stock ? flowerSnapshot(stock) : flower.snapshot } : flower),
                    position: [...flower.position] as Vector3,
                    rotation: [...flower.rotation] as Vector3,
                };
            })
        );
        setWrappingKind(configuration.wrappingKind);
        setSelectedId(null);
        cancelContinuousEdit();
        historyRef.current = { past: [], future: [] };
        updateHistoryStatus();
    }, [cancelContinuousEdit, replaceFlowers, setSelectedId, setWrappingKind,
        updateHistoryStatus, stockFlowers, legacyLinks]);

    useEffect(() => {
        if (storageInitializationRef.current) return;
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled || storageInitializationRef.current) return;
            storageInitializationRef.current = true;

            if (editCartItemId) {
                const item = readCartItems().find(
                    (candidate) => candidate.id === editCartItemId
                );

                if (item?.itemType === "custom-bouquet") {
                    const configuration = sanitizeCustomBouquetConfig(
                        item.configuration
                    );

                    if (configuration) {
                        restoreConfiguration(configuration);
                        setEditingItemId(item.id);
                    } else {
                        setCartActionMessage(
                            "Конфигурация букета повреждена. Открыт новый редактор."
                        );
                    }
                } else {
                    setCartActionMessage(
                        "Букет из корзины не найден. Открыт новый редактор."
                    );
                }
            } else {
                setDraftOffer(readBouquetDraft());
            }

            setStorageReady(true);
        });

        return () => {
            cancelled = true;
        };
    }, [editCartItemId, restoreConfiguration]);

    useEffect(() => {
        if (
            !storageReady ||
            editingItemId ||
            draftOffer ||
            !flowers.length ||
            cartSavePendingRef.current
        ) {
            return;
        }

        const timeout = window.setTimeout(() => {
            const configuration = sanitizeCustomBouquetConfig(
                createBouquetConfiguration(flowersRef.current, wrappingKind)
            );

            if (!configuration) return;

            const draft: BouquetDraft = {
                schemaVersion: 1,
                configuration,
                updatedAt: new Date().toISOString(),
            };

            try {
                window.localStorage.setItem(
                    BOUQUET_DRAFT_KEY,
                    JSON.stringify(draft)
                );
            } catch {
                // Draft persistence is best-effort and must not interrupt editing.
            }
        }, 450);

        return () => window.clearTimeout(timeout);
    }, [draftOffer, editingItemId, flowers, storageReady, wrappingKind]);

    useEffect(() => {
        if (!draftOffer) return;

        const dialog = draftDialogRef.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        draftContinueButtonRef.current?.focus();

        const handleDraftKeys = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                restoreConfiguration(draftOffer.configuration);
                setDraftOffer(null);
                return;
            }

            if (event.key !== "Tab" || !dialog) return;

            const buttons = Array.from(
                dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])")
            );
            const first = buttons[0];
            const last = buttons.at(-1);

            if (!first || !last) return;

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleDraftKeys);
        return () => {
            document.removeEventListener("keydown", handleDraftKeys);
            document.body.style.overflow = previousOverflow;
        };
    }, [draftOffer, restoreConfiguration]);

    const moveFlower = useCallback(
        (id: string, position: Vector3) => {
            const current = flowersRef.current;
            const moved = current.map((item) =>
                item.id === id
                    ? { ...item, position }
                    : item
            );
            const bouquetRadius = getBouquetRadius(moved);

            replaceFlowers(
                resolveFlowerCollisions(
                    moved,
                    id,
                    bouquetRadius
                )
            );
        },
        [replaceFlowers]
    );

    const selectedFlower = flowers.find(
        (flower) => flower.id === selectedId
    );

    const selectedOption = selectedFlower
        ? { name: selectedFlower.snapshot?.name ?? `Цветок ${selectedFlower.kind ?? selectedFlower.flowerId ?? "без связи"}` }
        : undefined;

    const changeSelectedHeight = (
        height: number
    ) => {
        if (!selectedId) return;

        replaceFlowers(
            flowersRef.current.map((flower) =>
                flower.id === selectedId
                    ? {
                        ...flower,
                        position: [
                            flower.position[0],
                            height,
                            flower.position[2],
                        ],
                    }
                    : flower
            )
        );
    };

    const changeSelectedTilt = (
        axis: "x" | "z",
        tilt: number
    ) => {
        if (!selectedId) return;

        replaceFlowers(
            flowersRef.current.map((flower) => {
                if (flower.id !== selectedId) {
                    return flower;
                }

                const [
                    rotationX,
                    rotationY,
                    rotationZ,
                ] = flower.rotation;

                return {
                    ...flower,
                    rotation:
                        axis === "x"
                            ? [
                                tilt,
                                rotationY,
                                rotationZ,
                            ]
                            : [
                                rotationX,
                                rotationY,
                                tilt,
                            ],
                };
            })
        );
    };

    const shuffleFlowers = () => {
        commitFlowerChange((current) => {
            if (!current.length) {
                return current;
            }

            const bouquetRadius = getBouquetRadius(current);
            const randomized = generateRandomBouquetLayout(
                current,
                bouquetRadius
            );

            return alignStemsToAnchor(
                randomized,
                bouquetRadius,
                AUTO_COMPOSITION_HEIGHT_OFFSET
            );
        });
    };

    const distributeFlowers = () => {
        commitFlowerChange((current) => {
            if (!current.length) {
                return current;
            }

            const bouquetRadius = getBouquetRadius(current);
            const distributed = generateEvenBouquetLayout(
                current,
                bouquetRadius
            );

            return alignStemsToAnchor(
                distributed,
                bouquetRadius,
                AUTO_COMPOSITION_HEIGHT_OFFSET
            );
        });
    };

    const deleteSelectedFlower = useCallback(() => {
        if (!selectedId) return;

        finishContinuousEdit();

        commitFlowerChange((current) => {
            const remaining = current.filter(
                (flower) =>
                    flower.id !== selectedId
            );

            return resolveFlowerCollisions(
                remaining,
                null,
                getBouquetRadius(remaining)
            );
        });

        setSelectedId(null);
        setIsDragging(false);
    }, [
        commitFlowerChange,
        finishContinuousEdit,
        selectedId,
        setIsDragging,
        setSelectedId,
    ]);

    const addFlower = (option: PublicFlower) => {
        if (flowersRef.current.length >= MAX_FLOWERS ||
            flowersRef.current.filter((flower) => flower.flowerId === option.id).length >= option.availableQuantity) {
            return;
        }

        const id = crypto.randomUUID();

        commitFlowerChange((current) => {
            if (current.length >= MAX_FLOWERS) {
                return current;
            }

            const draft: FlowerInstance = {
                id,
                flowerId: option.id,
                snapshot: flowerSnapshot(option),
                position: [0, 0, 0],
                rotation: [0, 0, 0],
            };
            const bouquetRadius = getBouquetRadius([
                ...current,
                draft,
            ]);
            const added = [
                ...current,
                {
                    ...draft,
                    ...getPlacement(
                        current.length,
                        bouquetRadius,
                        undefined
                    ),
                },
            ];

            return resolveFlowerCollisions(
                added,
                id,
                bouquetRadius
            );
        });

        setSelectedId(id);
    };

    const handleDragChange = useCallback((dragging: boolean) => {
        if (dragging) {
            beginContinuousEdit();
        } else {
            finishContinuousEdit();
        }

        setIsDragging(dragging);
    }, [beginContinuousEdit, finishContinuousEdit]);

    const undo = useCallback(() => {
        finishContinuousEdit();

        const history = historyRef.current;
        const previous = history.past.at(-1);

        if (!previous) {
            return;
        }

        history.past = history.past.slice(0, -1);
        history.future = [flowersRef.current, ...history.future].slice(0, 40);
        replaceFlowers(previous);
        setSelectedId((current) =>
            current && previous.some((flower) => flower.id === current)
                ? current
                : null
        );
        setIsDragging(false);
        updateHistoryStatus();
    }, [
        finishContinuousEdit,
        replaceFlowers,
        setIsDragging,
        setSelectedId,
        updateHistoryStatus,
    ]);

    const redo = useCallback(() => {
        finishContinuousEdit();

        const history = historyRef.current;
        const next = history.future[0];

        if (!next) {
            return;
        }

        history.future = history.future.slice(1);
        history.past = [
            ...history.past.slice(-39),
            flowersRef.current,
        ];
        replaceFlowers(next);
        setSelectedId((current) =>
            current && next.some((flower) => flower.id === current)
                ? current
                : null
        );
        setIsDragging(false);
        updateHistoryStatus();
    }, [
        finishContinuousEdit,
        replaceFlowers,
        setIsDragging,
        setSelectedId,
        updateHistoryStatus,
    ]);

    const closeClearDialog = useCallback(() => {
        setClearDialogOpen(false);
        window.requestAnimationFrame(() => clearButtonRef.current?.focus());
    }, [setClearDialogOpen]);

    const confirmClear = useCallback(() => {
        commitFlowerChange(() => []);
        setSelectedId(null);
        cancelContinuousEdit();

        if (!editingItemId) {
            window.localStorage.removeItem(BOUQUET_DRAFT_KEY);
        }

        closeClearDialog();
    }, [
        cancelContinuousEdit,
        closeClearDialog,
        commitFlowerChange,
        editingItemId,
        setSelectedId,
    ]);

    const continueDraft = useCallback(() => {
        if (!draftOffer) return;
        restoreConfiguration(draftOffer.configuration);
        setDraftOffer(null);
    }, [draftOffer, restoreConfiguration]);

    const startFreshBouquet = useCallback(() => {
        window.localStorage.removeItem(BOUQUET_DRAFT_KEY);
        replaceFlowers([]);
        setWrappingKind("blush");
        setSelectedId(null);
        cancelContinuousEdit();
        historyRef.current = { past: [], future: [] };
        updateHistoryStatus();
        setDraftOffer(null);
    }, [
        cancelContinuousEdit,
        replaceFlowers,
        setDraftOffer,
        setSelectedId,
        setWrappingKind,
        updateHistoryStatus,
    ]);

    const resetCamera = useCallback(() => {
        controlsRef.current?.reset();
    }, []);

    const releasePreviewUrl = useCallback(() => {
        if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
        }
    }, []);

    const closePreview = useCallback(() => {
        releasePreviewUrl();
        setPreviewUrl(null);
        setMapPreviewOpen(false);
        window.requestAnimationFrame(() => previewButtonRef.current?.focus());
    }, [releasePreviewUrl, setPreviewUrl]);

    const captureBouquetPreview = useCallback(async () => {
        if (
            isPreparingPreview ||
            previewCapturePendingRef.current ||
            !flowersRef.current.length
        ) {
            return;
        }

        if (flowersRef.current.some((flower) => !flower.kind && !flower.snapshot?.model) || !modelsReadyForPreview(renderStateRef.current?.scene)) {
            setPreviewError(null);
            setMapPreviewOpen(true);
            return;
        }
        if (!renderStateRef.current) {
            setPreviewError(
                "3D-сцена ещё загружается. Попробуйте через секунду."
            );
            return;
        }

        previewCapturePendingRef.current = true;
        setPreviewError(null);
        setIsPreparingPreview(true);
        releasePreviewUrl();
        setPreviewUrl(null);

        try {
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );

            const { gl, scene, camera } = renderStateRef.current;
            gl.render(scene, camera);

            const blob = await new Promise<Blob>((resolve, reject) => {
                gl.domElement.toBlob((result) => {
                    if (result) {
                        resolve(result);
                    } else {
                        reject(new Error("Canvas did not produce an image"));
                    }
                }, "image/png");
            });

            if (!mountedRef.current) {
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            previewUrlRef.current = objectUrl;
            setPreviewUrl(objectUrl);
        } catch {
            if (mountedRef.current) {
                setPreviewError(
                    "Не удалось создать превью. Попробуйте ещё раз."
                );
            }
        } finally {
            previewCapturePendingRef.current = false;

            if (mountedRef.current) {
                setIsPreparingPreview(false);
            }
        }
    }, [
        isPreparingPreview,
        releasePreviewUrl,
        setIsPreparingPreview,
        setPreviewError,
        setPreviewUrl,
    ]);

    const saveBouquetToCart = useCallback(async () => {
        if (cartSavePendingRef.current) return;

        const configuration = sanitizeCustomBouquetConfig(
            createBouquetConfiguration(flowersRef.current, wrappingKind)
        );

        if (!configuration || configuration.schemaVersion !== 2) {
            setCartActionMessage(
                "Выберите складскую позицию для каждого цветка. Букет должен содержать от 1 до 21 цветка."
            );
            return;
        }

        const copies = readCartItems().find((item) => item.id === editingItemId)?.quantity ?? 1;
        const counts = new Map<string, number>();
        for (const flower of configuration.flowers) counts.set(flower.flowerId!, (counts.get(flower.flowerId!) ?? 0) + copies);
        for (const [id, count] of counts) {
            const stock = stockFlowers.find((item) => item.id === id);
            if (!stock || count > stock.availableQuantity) {
                setCartActionMessage(`Недостаточно цветов: ${stock?.name ?? id}. Уменьшите количество или выберите другую позицию.`);
                return;
            }
        }

        cartSavePendingRef.current = true;
        const selectedBeforeSave = selectedId;
        setSelectedId(null);
        setCartActionMessage(null);
        setCartSavePhase("thumbnail");

        try {
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );

            let thumbnail: string | undefined;

            try {
                const renderState = renderStateRef.current;

                if (renderState && !configuration.flowers.some((flower) => !flower.kind && !flower.snapshot?.model) && modelsReadyForPreview(renderState.scene)) {
                    thumbnail = await createCartThumbnail(
                        renderState.gl,
                        renderState.scene,
                        renderState.camera
                    );
                }
            } catch {
                thumbnail = undefined;
            }

            setCartSavePhase("saving");

            const cart = readCartItems();
            const now = new Date().toISOString();
            const unitPrice = calculateCustomBouquetPrice(configuration);
            const summary = createCustomBouquetSummary(configuration);
            let nextCart = cart;
            let notice = "added";

            if (editingItemId) {
                const existing = cart.find(
                    (item) => item.id === editingItemId
                );

                if (existing?.itemType !== "custom-bouquet") {
                    throw new Error("Редактируемый букет больше не найден в корзине.");
                }

                const updated: CustomBouquetCartItem = {
                    ...existing,
                    unitPrice,
                    configuration,
                    summary,
                    thumbnail,
                    updatedAt: now,
                };

                nextCart = cart.map((item) =>
                    item.id === editingItemId ? updated : item
                );
                notice = "updated";
            } else {
                const item: CustomBouquetCartItem = {
                    id: `custom-bouquet-${crypto.randomUUID()}`,
                    itemType: "custom-bouquet",
                    name: "Авторский букет",
                    quantity: 1,
                    unitPrice,
                    configuration,
                    summary,
                    thumbnail,
                    createdAt: now,
                    updatedAt: now,
                };

                nextCart = [...cart, item];
            }

            writeCartItems(nextCart);

            if (!editingItemId) {
                window.localStorage.removeItem(BOUQUET_DRAFT_KEY);
            }

            const thumbnailNotice = configuration.schemaVersion === 2 ? "" : thumbnail ? "" : "&preview=missing";
            router.push(`/?cart=open&notice=${notice}${thumbnailNotice}`);
        } catch (error) {
            setSelectedId(selectedBeforeSave);
            setCartActionMessage(
                error instanceof Error
                    ? error.message
                    : "Не удалось сохранить букет. Попробуйте ещё раз."
            );
        } finally {
            cartSavePendingRef.current = false;

            if (mountedRef.current) {
                setCartSavePhase(null);
            }
        }
    }, [
        editingItemId,
        router,
        selectedId,
        setCartActionMessage,
        setCartSavePhase,
        setSelectedId,
        wrappingKind,
        stockFlowers,
    ]);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            previewCapturePendingRef.current = false;
            cartSavePendingRef.current = false;
            renderStateRef.current = null;
            releasePreviewUrl();
        };
    }, [releasePreviewUrl]);

    useEffect(() => {
        if (!previewUrl && !mapPreviewOpen) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        const modal = previewModalRef.current;

        document.body.style.overflow = "hidden";
        previewCloseButtonRef.current?.focus();

        const keepFocusInside = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closePreview();
                return;
            }

            if (event.key !== "Tab" || !modal) {
                return;
            }

            const focusable = Array.from(
                modal.querySelectorAll<HTMLElement>(
                    "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
                )
            );
            const first = focusable[0];
            const last = focusable.at(-1);

            if (!first || !last) {
                event.preventDefault();
                return;
            }

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", keepFocusInside);

        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", keepFocusInside);
        };
    }, [closePreview, previewUrl, mapPreviewOpen]);

    useEffect(() => {
        if (clearDialogOpen) {
            cancelClearButtonRef.current?.focus();
        }
    }, [clearDialogOpen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (previewUrl || mapPreviewOpen) {
                return;
            }

            const target = event.target as HTMLElement | null;
            const editable = Boolean(
                target?.matches("input, textarea, select") ||
                target?.isContentEditable
            );

            if (event.key === "Escape") {
                if (clearDialogOpen) {
                    closeClearDialog();
                } else {
                    setSelectedId(null);
                }

                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();

                if (event.shiftKey) {
                    redo();
                } else {
                    undo();
                }

                return;
            }

            if (
                !editable &&
                selectedId &&
                (event.key === "Delete" || event.key === "Backspace")
            ) {
                event.preventDefault();
                deleteSelectedFlower();
            }
        };

        window.addEventListener("keydown", onKeyDown);

        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        clearDialogOpen,
        closeClearDialog,
        deleteSelectedFlower,
        redo,
        previewUrl,
        mapPreviewOpen,
        selectedId,
        undo,
    ]);

    const currentConfiguration = sanitizeCustomBouquetConfig(
        createBouquetConfiguration(flowers, wrappingKind)
    );
    const total = currentConfiguration && currentConfiguration.flowers.every((flower) => flower.snapshot)
        ? calculateCustomBouquetPrice(currentConfiguration)
        : 0;
    const flowerTotal = total
        ? total - wrapping.price
        : 0;
    const isCartSaving = cartSavePhase !== null;

    return (
        <div className="grid h-full min-h-0 w-full max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(300px,55dvh)_minmax(0,1fr)] overflow-hidden bg-white lg:grid-cols-[380px_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="order-2 h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden border-t border-[#f0dfd9] p-5 sm:p-6 lg:order-1 lg:border-r lg:border-t-0">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b07b72]">
                            Шаг 1
                        </p>

                        <h3 className="mt-2 font-serif text-3xl">
                            Выберите цветы
                        </h3>
                    </div>

                    <span className="rounded-full bg-[#fff1ed] px-3 py-1.5 text-xs font-semibold text-[#a85f56]">
                        {flowers.length}/{MAX_FLOWERS}
                    </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-[#8a746e]">
                    Нажмите на цветок — он появится
                    в композиции справа.
                </p>

                {editingItemId && (
                    <div className="mt-4 rounded-2xl border border-[#e8c8c2] bg-[#fff1ed] px-4 py-3 text-sm text-[#8f554c]">
                        Вы редактируете авторский букет из корзины.
                    </div>
                )}

                {cartActionMessage && (
                    <p
                        role="alert"
                        className="mt-4 rounded-2xl border border-[#efc8c2] bg-[#fff7f5] px-4 py-3 text-sm leading-5 text-[#9f4f5d]"
                    >
                        {cartActionMessage}
                    </p>
                )}

                <label className="mt-5 block text-sm">
                    Поиск по названию
                    <input value={search} onChange={(event) => setSearch(event.target.value)} type="search"
                        className="mt-2 w-full rounded-xl border border-[#ead8d1] p-3" />
                </label>
                <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
                    {stockFlowers.filter((option) => option.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))).map((option) => {
                        const count = flowers.filter((flower) => flower.flowerId === option.id).length;
                        return (
                            <button key={option.id} type="button" onClick={() => addFlower(option)}
                                disabled={flowers.length >= MAX_FLOWERS || count >= option.availableQuantity}
                                className="group flex w-full items-center gap-4 rounded-[22px] border border-[#efdfda] bg-[#fffaf8] p-3.5 text-left transition hover:border-[#dfa9a0] hover:bg-white disabled:cursor-not-allowed disabled:opacity-45">
                                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#f7e9e4]">
                                    <BouquetImage src={option.imageUrl} name={option.name} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold">{option.name}</span>
                                    <span className="mt-0.5 block text-xs text-[#98827c]">
                                        {money(option.salePrice)} · {option.availableQuantity > 0 ? `Доступно: ${option.availableQuantity}` : "Нет в наличии"}
                                        {option.color ? ` · ${option.color}` : ""}
                                    </span>
                                </span>
                                <span className="grid h-9 min-w-9 place-items-center rounded-full bg-white px-2 text-sm font-bold text-[#b85d70]">{count || "+"}</span>
                            </button>
                        );
                    })}
                    {!stockFlowers.length && <p className="text-sm">Сейчас нет активных цветов. Ассортимент скоро пополнится.</p>}
                </div>
                {flowers.length > 0 && (
                    <section className="mt-5 space-y-2 text-sm">
                        <h4 className="font-semibold">Состав и выбор экземпляра</h4>
                        {flowers.some((flower) => !flower.kind && !flower.snapshot?.model) && <p>3D-модель этого цветка пока не добавлена. Полное расположение показано на карте; цветы можно выбирать, перемещать и удалять.</p>}
                        {currentConfiguration?.schemaVersion === 2 && <p>{formatCustomBouquetComposition(createCustomBouquetSummary(currentConfiguration))}</p>}
                        <FlowerInstanceGroups flowers={flowers} selectedId={selectedId} onSelect={setSelectedId}
                          renderUnlinked={(flower) => ((!flower.flowerId || !stockFlowers.some((stock) => stock.id === flower.flowerId)) && (
                                    <label className="mt-2 block">Нужно выбрать складскую позицию
                                        <select value="" className="mt-1 w-full rounded border p-2" onChange={(event) => {
                                            const stock = stockFlowers.find((item) => item.id === event.target.value);
                                            if (!stock || flowersRef.current.filter((item) => item.flowerId === stock.id).length >= stock.availableQuantity) return;
                                            commitFlowerChange((current) => current.map((item) => item.id === flower.id
                                                ? { id: item.id, flowerId: stock.id, snapshot: flowerSnapshot(stock), position: item.position, rotation: item.rotation } : item));
                                        }}>
                                            <option value="">Выберите цветок</option>
                                            {stockFlowers.map((stock) => <option key={stock.id} value={stock.id} disabled={stock.availableQuantity === 0}>{stock.name}</option>)}
                                        </select>
                                    </label>
                                ))} />
                    </section>
                )}

                <div className="mt-7">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b07b72]">
                                Шаг 2
                            </p>

                            <h3 className="mt-1 font-serif text-2xl">
                                Выберите упаковку
                            </h3>
                        </div>

                        <span
                            className="h-8 w-8 rounded-full border-4 border-white shadow-md"
                            style={{
                                backgroundColor: wrapping.color,
                            }}
                        />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                        {WRAPPINGS.map((option) => {
                            const active =
                                option.kind === wrappingKind;

                            return (
                                <button
                                    key={option.kind}
                                    type="button"
                                    onClick={() =>
                                        setWrappingKind(option.kind)
                                    }
                                    className={`rounded-[18px] border p-3 text-center transition ${active
                                        ? "border-[#c97d72] bg-[#fff1ed] shadow-sm"
                                        : "border-[#efdfda] bg-white hover:border-[#dfa9a0]"
                                        }`}
                                >
                                    <span
                                        className="mx-auto block h-8 w-8 rounded-full border-2 border-white shadow-sm"
                                        style={{
                                            backgroundColor: option.color,
                                        }}
                                    />

                                    <span className="mt-2 block text-xs font-semibold text-[#49332d]">
                                        {option.name}
                                    </span>

                                    <span className="mt-1 block text-[11px] text-[#98827c]">
                                        {money(option.price)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <p className="mt-3 text-xs leading-5 text-[#8a746e]">
                        {wrapping.subtitle}. Цвет упаковки и ленты
                        сразу отображается на букете.
                    </p>
                </div>

                <div className="mt-5 rounded-[22px] border border-[#efd7d2] bg-[#fffaf8] p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b07b72]">
                        Автокомпозиция
                    </p>

                    <p className="mt-2 text-xs leading-5 text-[#8a746e]">
                        Перемешайте цветы случайным образом или распределите их ровно.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                        <button type="button" onClick={shuffleFlowers} disabled={!flowers.length || Boolean(cartSavePhase)} aria-label="Перемешать цветы"
                          className="min-h-14 min-w-0 rounded-2xl border border-[#e5c9c3] bg-white px-2 py-3 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-40">Перемешать</button>
                        <button type="button" onClick={distributeFlowers} disabled={!flowers.length || Boolean(cartSavePhase)} aria-label="Распределить ровно"
                          className="min-h-14 min-w-0 rounded-2xl border border-[#e5c9c3] bg-white px-2 py-3 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-40">Распределить ровно</button>
                    </div>
                </div>


                <div className="mt-7 rounded-[24px] bg-[#342622] p-5 text-white">
                    <div className="flex justify-between text-sm text-white/65">
                        <span>Цветы</span>
                        <span>{money(flowerTotal)}</span>
                    </div>

                    <div className="mt-2 flex justify-between text-sm text-white/65">
                        <span>Упаковка</span>
                        <span>
                            {flowers.length
                                ? money(wrapping.price)
                                : "—"}
                        </span>
                    </div>

                    <div className="my-4 h-px bg-white/12" />

                    <div className="flex items-end justify-between">
                        <span className="text-sm text-white/75">
                            Итого
                        </span>

                        <strong className="font-serif text-2xl font-normal">
                            {money(total)}
                        </strong>
                    </div>
                </div>

                <div className="sticky -bottom-5 -mx-5 -mb-5 mt-5 border-t border-[#f0dfd9] bg-white/96 p-5 shadow-[0_-12px_30px_rgba(74,48,41,0.06)] backdrop-blur-md sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:p-6">
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            ref={clearButtonRef}
                            type="button"
                            onClick={() => setClearDialogOpen(true)}
                            disabled={!flowers.length}
                            className="h-12 rounded-2xl border border-[#ead8d1] text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Очистить
                        </button>

                        <button
                            type="button"
                            onClick={saveBouquetToCart}
                            disabled={
                                !currentConfiguration || currentConfiguration.schemaVersion !== 2 ||
                                isCartSaving ||
                                isPreparingPreview ||
                                !storageReady
                            }
                            aria-busy={isCartSaving}
                            className="h-12 rounded-2xl bg-[#c97d72] text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.24)] transition hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {cartSavePhase === "thumbnail"
                                ? "Подготавливаем букет…"
                                : cartSavePhase === "saving"
                                    ? editingItemId
                                        ? "Сохраняем…"
                                        : "Добавляем…"
                                    : editingItemId
                                        ? "Сохранить изменения"
                                        : "Добавить в корзину"}
                        </button>
                    </div>

                    <span className="sr-only" aria-live="polite">
                        {cartSavePhase === "thumbnail"
                            ? "Подготавливаем миниатюру букета"
                            : cartSavePhase === "saving"
                                ? "Сохраняем букет в корзине"
                                : ""}
                    </span>
                </div>
            </aside>

            <section className="relative order-1 h-full min-h-0 min-w-0 overflow-hidden bg-[#fff4f1] lg:order-2">
                <div className="absolute left-4 top-4 z-30 flex items-center gap-1 rounded-2xl border border-[#ead8d1] bg-white/86 p-1.5 shadow-[0_12px_32px_rgba(74,48,41,0.11)] backdrop-blur-xl sm:left-5 sm:top-5">
                    <button
                        type="button"
                        aria-label="Отменить"
                        title="Отменить (Ctrl/Cmd + Z)"
                        onClick={undo}
                        disabled={!historyStatus.canUndo}
                        className="grid h-11 w-11 place-items-center rounded-xl text-[#6f554e] transition hover:bg-[#fff1ed] hover:text-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                            <path d="M9 7 4.5 11.5 9 16M5 11.5h7.5a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>

                    <button
                        type="button"
                        aria-label="Повторить"
                        title="Повторить (Ctrl/Cmd + Shift + Z)"
                        onClick={redo}
                        disabled={!historyStatus.canRedo}
                        className="grid h-11 w-11 place-items-center rounded-xl text-[#6f554e] transition hover:bg-[#fff1ed] hover:text-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                            <path d="m15 7 4.5 4.5L15 16m4-4.5h-7.5a6 6 0 0 0-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>

                    <div className="mx-1 h-6 w-px bg-[#ead8d1]" />

                    <button
                        type="button"
                        aria-label="Сбросить камеру"
                        title="Сбросить камеру"
                        onClick={resetCamera}
                        className="grid h-11 w-11 place-items-center rounded-xl text-[#6f554e] transition hover:bg-[#fff1ed] hover:text-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70]"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                            <path d="M19 8V4m0 0h-4m4 0-3.2 3.2A7 7 0 1 0 19 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>

                    <div className="mx-1 hidden h-6 w-px bg-[#ead8d1] sm:block" />

                    <button
                        ref={previewButtonRef}
                        type="button"
                        aria-label="Посмотреть букет"
                        aria-busy={isPreparingPreview}
                        title={flowers.some((flower) => !flower.kind && !flower.snapshot?.model) ? "Открыть схему композиции" : "Создать PNG-превью текущего ракурса"}
                        onClick={captureBouquetPreview}
                        disabled={!flowers.length || isPreparingPreview}
                        className="flex h-11 items-center gap-2 rounded-xl bg-[#342622] px-3 text-xs font-semibold text-white transition hover:bg-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:text-sm"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${isPreparingPreview ? "animate-pulse" : ""}`}>
                            <path d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4v-11Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                            <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                        </svg>
                        <span className="sm:hidden">
                            {isPreparingPreview ? "Создаём…" : "Просмотр"}
                        </span>
                        <span className="hidden sm:inline">
                            {isPreparingPreview ? "Создаём превью…" : "Посмотреть букет"}
                        </span>
                    </button>
                </div>

                {previewError && (
                    <div
                        role="alert"
                        className="absolute left-4 top-20 z-30 max-w-[min(320px,calc(100%-2rem))] rounded-2xl border border-[#efc8c2] bg-white/94 px-4 py-3 text-xs leading-5 text-[#9f4f5d] shadow-lg backdrop-blur sm:left-5"
                    >
                        {previewError}
                    </div>
                )}

                {!selectedFlower && (
                    <div className="pointer-events-none absolute right-4 top-4 z-10 hidden rounded-full border border-white/70 bg-white/75 px-4 py-2 text-xs font-medium text-[#806e68] shadow-sm backdrop-blur-md xl:block">
                        Потяните, чтобы вращать · колесо —
                        приблизить
                    </div>
                )}

                {selectedFlower && selectedOption && (
                    <div
                        className="absolute left-4 top-[76px] z-30 max-h-[calc(100%-92px)] w-[calc(50%-20px)] min-w-0 overflow-y-auto overscroll-contain rounded-[22px] border border-[#e7c9c3] bg-white/90 p-3 shadow-[0_18px_48px_rgba(74,48,41,0.14)] backdrop-blur-xl sm:left-5 sm:w-[320px] sm:p-5 lg:left-auto lg:right-6 lg:top-6 lg:max-h-[300px]"
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerMove={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div className="sticky -top-4 z-10 -mx-1 flex items-center justify-between gap-3 bg-white/94 px-1 pb-3 backdrop-blur-xl sm:-top-5">
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#b07b72]">
                                    Выбранный цветок
                                </p>

                                <p className="mt-0.5 truncate font-serif text-xl text-[#49332d]">
                                    {selectedOption.name}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <button
                                    type="button"
                                    aria-label={selectedPanelCollapsed ? "Развернуть настройки цветка" : "Свернуть настройки цветка"}
                                    title={selectedPanelCollapsed ? "Развернуть" : "Свернуть"}
                                    onClick={() => setSelectedPanelCollapsed((current) => !current)}
                                    className="grid h-10 w-10 place-items-center rounded-full text-[#806e68] transition hover:bg-[#fff1ed] hover:text-[#b85d70] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70]"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 transition-transform ${selectedPanelCollapsed ? "rotate-180" : ""}`}>
                                        <path d="m7 14 5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>

                                <button
                                    type="button"
                                    aria-label="Удалить выбранный цветок"
                                    title="Удалить цветок"
                                    onClick={deleteSelectedFlower}
                                    className="grid h-10 w-10 place-items-center rounded-full border border-[#efcfca] bg-white text-[#b85d70] transition hover:border-[#b85d70] hover:bg-[#b85d70] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b85d70]"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]">
                                        <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {!selectedPanelCollapsed && (
                            <div>
                                <p className="text-xs leading-5 text-[#8a746e]">
                                    Перетаскивайте цветок в сцене или на карте — соседние цветы аккуратно освободят место.
                                </p>

                                <label className="mt-4 block">
                                    <span className="flex justify-between text-xs font-semibold text-[#806e68]">
                                        <span>Высота</span>
                                        <span>{selectedFlower.position[1].toFixed(2)}</span>
                                    </span>
                                    <input
                                        type="range"
                                        min="-0.35"
                                        max="0.85"
                                        step="0.025"
                                        value={selectedFlower.position[1]}
                                        onPointerDown={beginContinuousEdit}
                                        onPointerUp={finishContinuousEdit}
                                        onPointerCancel={finishContinuousEdit}
                                        onKeyDown={beginContinuousEdit}
                                        onKeyUp={finishContinuousEdit}
                                        onBlur={finishContinuousEdit}
                                        onChange={(event) => changeSelectedHeight(Number(event.target.value))}
                                        className="mt-2 w-full accent-[#b85d70]"
                                    />
                                </label>

                                <label className="mt-4 block">
                                    <span className="flex justify-between text-xs font-semibold text-[#806e68]">
                                        <span>Вперёд / назад</span>
                                        <span>{Math.round(selectedFlower.rotation[0] * (180 / Math.PI))}°</span>
                                    </span>
                                    <input
                                        type="range"
                                        min="-0.65"
                                        max="0.65"
                                        step="0.025"
                                        value={selectedFlower.rotation[0]}
                                        onPointerDown={beginContinuousEdit}
                                        onPointerUp={finishContinuousEdit}
                                        onPointerCancel={finishContinuousEdit}
                                        onKeyDown={beginContinuousEdit}
                                        onKeyUp={finishContinuousEdit}
                                        onBlur={finishContinuousEdit}
                                        onChange={(event) => changeSelectedTilt("x", Number(event.target.value))}
                                        className="mt-2 w-full accent-[#b85d70]"
                                    />
                                </label>

                                <label className="mt-4 block pb-1">
                                    <span className="flex justify-between text-xs font-semibold text-[#806e68]">
                                        <span>Влево / вправо</span>
                                        <span>{Math.round(selectedFlower.rotation[2] * (180 / Math.PI))}°</span>
                                    </span>
                                    <input
                                        type="range"
                                        min="-0.65"
                                        max="0.65"
                                        step="0.025"
                                        value={selectedFlower.rotation[2]}
                                        onPointerDown={beginContinuousEdit}
                                        onPointerUp={finishContinuousEdit}
                                        onPointerCancel={finishContinuousEdit}
                                        onKeyDown={beginContinuousEdit}
                                        onKeyUp={finishContinuousEdit}
                                        onBlur={finishContinuousEdit}
                                        onChange={(event) => changeSelectedTilt("z", Number(event.target.value))}
                                        className="mt-2 w-full accent-[#b85d70]"
                                    />
                                </label>
                            </div>
                        )}
                    </div>
                )}

                {!flowers.length && (
                    <div className="pointer-events-none absolute left-4 top-1/2 z-10 w-[calc(50%-20px)] -translate-y-1/2 text-left sm:left-5 sm:w-[220px]">
                        <p className="font-serif text-xl text-[#7e625b] sm:text-2xl">
                            Ваш букет пока пуст
                        </p>

                        <p className="mt-1 text-sm text-[#9b817b]">
                            Добавьте первый цветок слева
                        </p>
                    </div>
                )}

                <Canvas
                    shadows="basic"
                    dpr={[1, 1.8]}
                    onCreated={({ gl, scene, camera }) => {
                        renderStateRef.current = { gl, scene, camera };
                    }}
                    onPointerMissed={() => {
                        if (!isDragging) {
                            setSelectedId(null);
                        }
                    }}
                    camera={{
                        position: [0, 2.8, 7.2],
                        fov: 40,
                    }}
                    gl={{
                        antialias: true,
                        alpha: false,
                        preserveDrawingBuffer: true,
                    }}
                >
                    <BouquetVisualScene
                        flowers={flowers}
                        wrapping={wrapping}
                        selectedId={selectedId}
                        isDragging={isDragging}
                        onSelect={setSelectedId}
                        onMove={moveFlower}
                        onDragChange={handleDragChange}
                        controlsRef={controlsRef}
                        hideSelection={isPreparingPreview || cartSavePhase === "thumbnail"}
                    />
                </Canvas>

                <BouquetTopViewMap
                    flowers={flowers}
                    selectedId={selectedId}
                    bouquetRadius={getBouquetRadius(flowers)}
                    compact={Boolean(selectedFlower)}
                    onSelect={setSelectedId}
                    onMove={moveFlower}
                    onDragStart={() => handleDragChange(true)}
                    onDragEnd={() => handleDragChange(false)}
                />
            </section>

            {draftOffer && (
                <div className="fixed inset-0 z-[70] grid place-items-center bg-[#342622]/45 p-5 backdrop-blur-sm">
                    <div
                        ref={draftDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="draft-dialog-title"
                        aria-describedby="draft-dialog-description"
                        className="w-full max-w-md rounded-[30px] border border-[#ead8d1] bg-white p-6 shadow-[0_28px_90px_rgba(52,38,34,0.28)] sm:p-8"
                    >
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b07b72]">
                            Сохранённый черновик
                        </p>

                        <h2
                            id="draft-dialog-title"
                            className="mt-2 font-serif text-3xl text-[#342622]"
                        >
                            Продолжить прошлый букет?
                        </h2>

                        <p
                            id="draft-dialog-description"
                            className="mt-3 text-sm leading-6 text-[#806e68]"
                        >
                            Мы сохранили незавершённую композицию.
                        </p>

                        <div className="mt-7 grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={startFreshBouquet}
                                className="min-h-12 rounded-2xl border border-[#ead8d1] px-4 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
                            >
                                Начать заново
                            </button>

                            <button
                                ref={draftContinueButtonRef}
                                type="button"
                                onClick={continueDraft}
                                className="min-h-12 rounded-2xl bg-[#c97d72] px-4 text-sm font-semibold text-white transition hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
                            >
                                Продолжить
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {(previewUrl || mapPreviewOpen) && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-[#241b18]/78 p-3 backdrop-blur-md sm:p-6"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closePreview();
                        }
                    }}
                >
                    <div
                        ref={previewModalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="bouquet-preview-title"
                        className="relative flex max-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/15 bg-[#342622] shadow-[0_32px_100px_rgba(0,0,0,0.42)] sm:max-h-[calc(100dvh-48px)]"
                    >
                        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-4 text-white sm:px-6">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#efb7c2]">
                                    {mapPreviewOpen ? "Схема композиции" : "PNG-превью"}
                                </p>
                                <h2 id="bouquet-preview-title" className="mt-1 font-serif text-xl sm:text-2xl">
                                    Ваш букет Lotus
                                </h2>
                            </div>

                            <button
                                ref={previewCloseButtonRef}
                                type="button"
                                aria-label="Закрыть превью"
                                title="Закрыть"
                                onClick={closePreview}
                                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efb7c2]"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                                    <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 bg-[#201917] p-3 sm:p-5">
                            <div className="relative h-[min(68dvh,760px)] min-h-[260px] w-full overflow-hidden rounded-[18px] bg-[#fff4f1]">
                                {mapPreviewOpen ? (
                                    <div className="flex h-full flex-col overflow-auto p-4">
                                        <p className="text-sm">{flowers.some((flower) => !flower.kind && !flower.snapshot?.model) ? "3D-модель этого цветка пока не добавлена." : "Некоторые 3D-модели ещё не загрузились."} На схеме показаны все экземпляры.</p>
                                        <div className="min-h-0 flex-1"><BouquetTopViewMap flowers={flowers} bouquetRadius={getBouquetRadius(flowers)} readonly standalone /></div>
                                        {currentConfiguration && <p className="text-sm">{formatCustomBouquetComposition(createCustomBouquetSummary(currentConfiguration))}</p>}
                                    </div>
                                ) : <Image
                                    src={previewUrl!}
                                    alt="PNG-превью созданного букета"
                                    fill
                                    unoptimized
                                    sizes="100vw"
                                    className="object-contain"
                                />}
                            </div>
                        </div>

                        <div className="grid shrink-0 gap-3 border-t border-white/10 bg-[#342622] p-4 sm:flex sm:justify-end sm:p-5">
                            <button
                                type="button"
                                onClick={closePreview}
                                className="h-12 rounded-2xl border border-white/20 px-5 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efb7c2]"
                            >
                                Вернуться к редактору
                            </button>

                            {previewUrl && <a
                                href={previewUrl}
                                download={`lotus-bouquet-${new Date().toISOString().slice(0, 10)}.png`}
                                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#d98291] px-6 text-sm font-semibold text-white transition hover:bg-[#c86f82] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#efb7c2]"
                            >
                                Скачать PNG
                            </a>}
                        </div>
                    </div>
                </div>
            )}

            {clearDialogOpen && (
                <div
                    className="fixed inset-0 z-50 grid place-items-center bg-[#342622]/35 p-5 backdrop-blur-sm"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeClearDialog();
                        }
                    }}
                >
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="clear-bouquet-title"
                        aria-describedby="clear-bouquet-description"
                        className="w-full max-w-sm rounded-[28px] border border-[#ead8d1] bg-white p-6 shadow-[0_24px_80px_rgba(52,38,34,0.22)] sm:p-7"
                    >
                        <h2 id="clear-bouquet-title" className="font-serif text-2xl text-[#342622]">
                            Очистить весь букет?
                        </h2>

                        <p id="clear-bouquet-description" className="mt-3 text-sm leading-6 text-[#806e68]">
                            Все добавленные цветы и их настройки будут удалены.
                        </p>

                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <button
                                ref={cancelClearButtonRef}
                                type="button"
                                onClick={closeClearDialog}
                                className="h-12 rounded-2xl border border-[#ead8d1] text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                onClick={confirmClear}
                                className="h-12 rounded-2xl bg-[#b85d70] text-sm font-semibold text-white transition hover:bg-[#a64f61] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
                            >
                                Очистить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
