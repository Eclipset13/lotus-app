"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type AdminSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type AdminSelectProps = {
  name: string;
  value?: string;
  defaultValue?: string;
  ariaLabel: string;
  options: AdminSelectOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  openAbove: boolean;
  edge: number;
};

const VIEWPORT_MARGIN = 12;
const MENU_GAP = 8;
const MAX_MENU_HEIGHT = 320;
const ESTIMATED_OPTION_HEIGHT = 44;
const MENU_VERTICAL_PADDING = 16;

export function AdminSelect({
  name,
  value,
  defaultValue = "",
  ariaLabel,
  options,
  onChange,
  disabled = false,
  placeholder,
  className = "",
}: AdminSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(value ?? defaultValue);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedValue = onChange ? value ?? internalValue : internalValue;

  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );
  const selectedIndex = selectedOption ? options.indexOf(selectedOption) : -1;
  const displayLabel =
    selectedOption?.label ?? placeholder ?? "Выберите вариант";

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN,
    );
    const availableAbove = Math.max(
      0,
      rect.top - MENU_GAP - VIEWPORT_MARGIN,
    );
    const estimatedHeight = Math.min(
      MAX_MENU_HEIGHT,
      options.length * ESTIMATED_OPTION_HEIGHT + MENU_VERTICAL_PADDING,
    );
    const openAbove =
      availableBelow < estimatedHeight && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const width = Math.min(
      rect.width,
      Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2),
    );
    const maximumLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - VIEWPORT_MARGIN - width,
    );

    setMenuPosition({
      left: Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maximumLeft),
      width,
      maxHeight: Math.min(MAX_MENU_HEIGHT, availableHeight),
      openAbove,
      edge: openAbove
        ? window.innerHeight - rect.top + MENU_GAP
        : rect.bottom + MENU_GAP,
    });
  }, [options.length]);

  function updateValue(nextValue: string) {
    setInternalValue(nextValue);
    onChange?.(nextValue);
  }

  function findEnabledIndex(startIndex: number, direction: 1 | -1) {
    let index = startIndex;
    while (index >= 0 && index < options.length) {
      if (!options[index].disabled) return index;
      index += direction;
    }
    return -1;
  }

  function openingIndex(direction: 1 | -1) {
    if (selectedIndex >= 0) return selectedIndex;
    return findEnabledIndex(
      direction === 1 ? 0 : options.length - 1,
      direction,
    );
  }

  function openList(direction: 1 | -1 = 1) {
    updateMenuPosition();
    setActiveIndex(openingIndex(direction));
    setIsOpen(true);
  }

  useLayoutEffect(() => {
    if (isOpen) updateMenuPosition();
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    function closeOnOutsideFocus(event: FocusEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    let animationFrame: number | null = null;
    function schedulePositionUpdate() {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateMenuPosition();
      });
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", closeOnOutsideFocus);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", closeOnOutsideFocus);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const animationFrame = window.requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeIndex, isOpen]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      return;
    }

    if (!isOpen && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList(event.key === "ArrowUp" ? -1 : 1);
      return;
    }

    if (!isOpen) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const startIndex =
        activeIndex >= 0
          ? activeIndex + direction
          : direction === 1
            ? 0
            : options.length - 1;
      const nextIndex = findEnabledIndex(startIndex, direction);
      if (nextIndex >= 0) setActiveIndex(nextIndex);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const direction = event.key === "Home" ? 1 : -1;
      const nextIndex = findEnabledIndex(
        direction === 1 ? 0 : options.length - 1,
        direction,
      );
      if (nextIndex >= 0) setActiveIndex(nextIndex);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option && !option.disabled) {
        updateValue(option.value);
        setIsOpen(false);
      }
    }
  }

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        left: menuPosition.left,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        ...(menuPosition.openAbove
          ? { bottom: menuPosition.edge }
          : { top: menuPosition.edge }),
      }
    : undefined;

  const menu =
    isOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            onWheel={(event) => event.stopPropagation()}
            className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-[20px] border border-[#ead8d1] bg-white p-2 shadow-[0_18px_50px_rgba(74,48,41,0.16)] [touch-action:pan-y]"
          >
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              const isActive = index === activeIndex;

              return (
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => {
                    updateValue(option.value);
                    setIsOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    isSelected
                      ? "bg-[#fae9e5] font-semibold text-[#9f5f56]"
                      : "text-[#4d3934] hover:bg-[#fff4f1]"
                  } ${isActive && !isSelected ? "bg-[#fff4f1]" : ""} disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <span>{option.label}</span>

                  {isSelected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#c97d72] text-xs text-white">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={containerRef}
      className={`${className} relative ${isOpen ? "z-50" : "z-20"}`}
    >
      <input
        type="hidden"
        name={name}
        value={selectedValue}
        disabled={disabled}
      />

      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`flex h-12 w-full items-center justify-between rounded-2xl border bg-[#fffaf8] px-4 text-left text-sm font-medium text-[#4d3934] shadow-[0_6px_20px_rgba(99,67,58,0.04)] outline-none transition-all duration-200 ${
          isOpen
            ? "border-[#d89b91] bg-white ring-4 ring-[#f4cbc4]/25"
            : "border-[#ead8d1] hover:border-[#dcb8ae] hover:bg-white"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={!selectedOption ? "text-[#99817a]" : undefined}>
          {displayLabel}
        </span>

        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f8e7e2] text-[#a9685f]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M7 10L12 15L17 10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {menu}
    </div>
  );
}

export const AdminFilterSelect = AdminSelect;
