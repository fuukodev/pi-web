"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ConfigSelectOption<T extends string = string> {
  value: T;
  /** Primary text, e.g. "high". */
  label: string;
  /** Secondary text on the right, e.g. "High reasoning". */
  description?: string;
}

const PREFERRED_POPUP_HEIGHT = 260;
/** Least a downward popup may show before flipping above the trigger. */
const MIN_DOWNWARD_HEIGHT = 120;

/**
 * Dropdown for a config detail field.
 *
 * A native `<select>` cannot be made to match the ModelSelector beside it: its
 * popup is drawn by the OS and its closed state cannot carry a leading glyph.
 * This mirrors the app's other dropdowns — ModelSelector's field surface and
 * ModelOptionButton rows — so neighbouring fields and the chat composer's menus
 * read as one system.
 *
 * Behaviour kept from the native control it replaces: Escape closes only the
 * menu (the settings dialog must not close with it), arrow keys move through
 * options, outside clicks dismiss, and the trigger reports `aria-expanded`.
 */
export function ConfigSelect<T extends string>({ value, options, onChange, disabled = false, ariaLabel, icon }: {
  value: T;
  options: readonly ConfigSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Optional leading glyph, matching the composer's thinking control. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const [maxHeight, setMaxHeight] = useState(PREFERRED_POPUP_HEIGHT);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((option) => option.value === value);

  const openMenu = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    // Measure against the pane that clips this popup, not just the viewport.
    const pane = rootRef.current?.closest(".config-detail")?.getBoundingClientRect();
    const spaceBelow = (pane?.bottom ?? viewportHeight) - (rect?.bottom ?? 0) - 12;
    const spaceAbove = (rect?.top ?? 0) - (pane?.top ?? 0) - 12;
    // Prefer opening downward like every other menu in the app; only flip up when
    // the pane edge would otherwise leave almost nothing visible.
    const nextPlacement = spaceBelow >= MIN_DOWNWARD_HEIGHT || spaceBelow >= spaceAbove ? "down" : "up";
    setPlacement(nextPlacement);
    setMaxHeight(Math.max(
      MIN_DOWNWARD_HEIGHT,
      Math.min(PREFERRED_POPUP_HEIGHT, nextPlacement === "down" ? spaceBelow : spaceAbove),
    ));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  // Focus the current option once per open. Depending on `options`/`value`
  // directly would re-run on every parent render (they are rebuilt inline) and
  // yank focus back while the user is navigating.
  const focusTargetRef = useRef({ options, value });
  focusTargetRef.current = { options, value };
  useEffect(() => {
    if (!open) return;
    const target = focusTargetRef.current;
    const index = Math.max(0, target.options.findIndex((option) => option.value === target.value));
    optionRefs.current[index]?.focus();
  }, [open]);

  const moveFocus = (delta: number) => {
    const buttons = optionRefs.current.filter((button): button is HTMLButtonElement => button !== null);
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  return (
    <div ref={rootRef} className="config-select-field" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`config-select-button${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {icon}
        <span className="config-select-value">{selected?.label ?? value}</span>
        <svg className="config-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`config-select-popup is-${placement}`}
          style={{ maxHeight }}
        >
          {options.map((option, index) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={active}
                className={`config-select-option${active ? " is-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(option.value);
                }}
              >
                {active
                  ? <svg className="config-select-check" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                  : <span className="config-select-check" aria-hidden="true" />}
                <span className="config-select-option-label">{option.label}</span>
                {option.description && (
                  <span className="config-select-option-description">{option.description}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
