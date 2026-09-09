"use client";

import { useState, type ReactElement } from "react";
import { EyeIcon, EyeOffIcon } from "../../icons";
import { IconButton } from "../Button/Button";
import { Input, type InputProps } from "./Input";
import styles from "./forms.module.scss";

export function PasswordInput({
  revealLabel,
  hideLabel,
  ...props
}: InputProps & { revealLabel: string; hideLabel: string }): ReactElement {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <Input {...props} type={visible ? "text" : "password"} />
      <span className={styles.suffix}>
        <IconButton
          type="button"
          size="sm"
          label={visible ? hideLabel : revealLabel}
          onClick={() => {
            setVisible((value) => !value);
          }}
        >
          {visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </IconButton>
      </span>
    </div>
  );
}
