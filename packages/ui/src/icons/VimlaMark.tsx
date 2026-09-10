import type { ReactElement } from "react";

export function VimlaMark({
  size = 20,
  title = "Vimla",
}: {
  size?: number;
  title?: string;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M12 3.2 20.4 20.8H16.7L12 10.6 7.3 20.8H3.6L12 3.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
