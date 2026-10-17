"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * One editable parameter: the name, the number as it reads, and the slider under it.
 *
 * The number is a real field, not a label, because a professional editor is expected to take a
 * typed value: Enter or blur commits it, Escape abandons it, and out-of-range input lands on the
 * nearest legal value instead of being rejected. The wheel over the row nudges by a step (ten
 * with Shift held), and a double click returns the dial to the value its owner calls home.
 */

export type ParameterDialProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** What the number carries, e.g. "%", "dB" or "s". */
  unit?: string;
  /** Where a double click returns; without one the dial has no home to go to. */
  home?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

export function ParameterDial({ label, value, min, max, step = 1, unit, home, hint, disabled, onChange }: ParameterDialProps) {
  const rowRef = useRef<HTMLLabelElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const shown = draft ?? value.toFixed(decimals);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  // A value that changed from anywhere else abandons a half-typed draft rather than fighting it.
  useEffect(() => {
    setDraft(null);
  }, [value]);

  // The wheel is bound natively so a nudge does not also scroll the panel under the pointer.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || disabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      onChange(clamp(value + direction * step * (event.shiftKey ? 10 : 1)));
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  });

  function commit(raw: string) {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setDraft(null);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    }
  }

  return (
    <label
      ref={rowRef}
      className={`parameter-dial${disabled ? " is-disabled" : ""}`}
      title={hint}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (home !== undefined && !disabled) onChange(clamp(home));
      }}
    >
      <span className="dial-head">
        <span className="dial-label">{label}</span>
        <span className="dial-value">
          <input
            ref={fieldRef}
            className="dial-number"
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            aria-label={`${label} value`}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              setDraft(value.toFixed(decimals));
              event.currentTarget.select();
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          {unit ? <em>{unit}</em> : null}
        </span>
      </span>
      <input
        className="dial-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
      />
    </label>
  );
}

/** A labelled switch — the shape every on/off in this editor shares. */
export function ParameterToggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`parameter-toggle${checked ? " is-on" : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
      {label}
    </button>
  );
}
