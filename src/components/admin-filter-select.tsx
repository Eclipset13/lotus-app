"use client";

import { useEffect, useId, useRef, useState } from "react";

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
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listboxId = useId();
    const selectedValue = onChange ? value ?? internalValue : internalValue;

    const selectedOption = options.find(
        (option) => option.value === selectedValue,
    );
    const selectedIndex = selectedOption
        ? options.indexOf(selectedOption)
        : -1;
    const displayLabel = selectedOption?.label ?? placeholder ?? "Выберите вариант";

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

    function openList(preferredIndex = selectedIndex) {
        setIsOpen(true);
        setActiveIndex(
            findEnabledIndex(
                preferredIndex >= 0 ? preferredIndex : 0,
                preferredIndex >= 0 ? 1 : 1,
            ),
        );
    }

    useEffect(() => {
        function closeOnOutsideClick(event: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        }

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        }

        document.addEventListener("mousedown", closeOnOutsideClick);
        document.addEventListener("keydown", closeOnEscape);

        return () => {
            document.removeEventListener("mousedown", closeOnOutsideClick);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, []);

    function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
        if (disabled) return;

        if (event.key === "Escape") {
            event.preventDefault();
            setIsOpen(false);
            return;
        }

        if (!isOpen && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            openList(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
            return;
        }

        if (!isOpen) return;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const startIndex = activeIndex >= 0 ? activeIndex + direction : selectedIndex;
            const nextIndex = findEnabledIndex(
                startIndex >= 0 ? startIndex : direction === 1 ? 0 : options.length - 1,
                direction,
            );
            if (nextIndex >= 0) setActiveIndex(nextIndex);
            return;
        }

        if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const index = event.key === "Home" ? 0 : options.length - 1;
            const direction = event.key === "Home" ? 1 : -1;
            const nextIndex = findEnabledIndex(index, direction);
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
                disabled={disabled}
                onClick={() => (isOpen ? setIsOpen(false) : openList())}
                onKeyDown={handleKeyDown}
                className={`flex h-12 w-full items-center justify-between rounded-2xl border bg-[#fffaf8] px-4 text-left text-sm font-medium text-[#4d3934] shadow-[0_6px_20px_rgba(99,67,58,0.04)] outline-none transition-all duration-200 ${isOpen
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
                        className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                            }`}
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

            {isOpen && (
                <div
                    id={listboxId}
                    role="listbox"
                    aria-label={ariaLabel}
                    className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[20px] border border-[#ead8d1] bg-white p-2 shadow-[0_18px_50px_rgba(74,48,41,0.16)]"
                >
                    {options.map((option, index) => {
                        const isSelected = option.value === selectedValue;
                        const isActive = option.value === options[activeIndex]?.value;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={option.disabled}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => {
                                    updateValue(option.value);
                                    setIsOpen(false);
                                    buttonRef.current?.focus();
                                }}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${isSelected
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
                </div>
            )}
        </div>
    );
}

export const AdminFilterSelect = AdminSelect;
