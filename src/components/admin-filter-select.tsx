"use client";

import { useEffect, useRef, useState } from "react";

type SelectOption = {
    value: string;
    label: string;
};

type AdminFilterSelectProps = {
    name: string;
    value: string;
    ariaLabel: string;
    options: SelectOption[];
};

export function AdminFilterSelect({
    name,
    value,
    ariaLabel,
    options,
}: AdminFilterSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedValue, setSelectedValue] = useState(value);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption =
        options.find((option) => option.value === selectedValue) ??
        options[0];

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

    return (
        <div ref={containerRef} className="relative">
            <input type="hidden" name={name} value={selectedValue} />

            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => setIsOpen((current) => !current)}
                className={`flex h-12 w-full items-center justify-between rounded-2xl border bg-[#fffaf8] px-4 text-left text-sm font-medium text-[#4d3934] shadow-[0_6px_20px_rgba(99,67,58,0.04)] outline-none transition-all duration-200 ${isOpen
                        ? "border-[#d89b91] bg-white ring-4 ring-[#f4cbc4]/25"
                        : "border-[#ead8d1] hover:border-[#dcb8ae] hover:bg-white"
                    }`}
            >
                <span>{selectedOption.label}</span>

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
                    role="listbox"
                    className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[20px] border border-[#ead8d1] bg-white p-2 shadow-[0_18px_50px_rgba(74,48,41,0.16)]"
                >
                    {options.map((option) => {
                        const isSelected = option.value === selectedValue;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                    setSelectedValue(option.value);
                                    setIsOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${isSelected
                                        ? "bg-[#fae9e5] font-semibold text-[#9f5f56]"
                                        : "text-[#4d3934] hover:bg-[#fff4f1]"
                                    }`}
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
