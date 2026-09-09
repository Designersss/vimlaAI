import type { ReactElement } from "react";
import { SearchIcon } from "../../icons";
import { Input, type InputProps } from "./Input";
import styles from "./forms.module.scss";

export function SearchInput(props: InputProps): ReactElement {
  return (
    <div className={styles.searchWrap}>
      <SearchIcon className={styles.searchIcon} size={16} aria-hidden="true" />
      <Input {...props} type="search" />
    </div>
  );
}
