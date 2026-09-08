"use client";

import {
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import styles from "./OtpInput.module.scss";

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
  labelledBy: string;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  errorId,
  invalid = false,
  labelledBy,
}: OtpInputProps): ReactElement {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  function updateAt(index: number, next: string): void {
    const clean = next.replace(/\D/g, "").slice(0, length - index);
    const chars = digits.slice();
    if (clean.length === 0) {
      chars[index] = "";
      onChange(chars.join(""));
      return;
    }

    for (let offset = 0; offset < clean.length; offset += 1) {
      chars[index + offset] = clean[offset] ?? "";
    }
    onChange(chars.join("").slice(0, length));
    const focusIndex = Math.min(index + clean.length, length - 1);
    inputs.current[focusIndex]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    updateAt(0, event.clipboardData.getData("text"));
  }

  return (
    <div className={styles.row} role="group" aria-labelledby={labelledBy}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          className={styles.cell}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={errorId}
          onChange={(event) => {
            updateAt(index, event.target.value);
          }}
          onKeyDown={(event) => {
            onKeyDown(index, event);
          }}
          onPaste={onPaste}
        />
      ))}
    </div>
  );
}
