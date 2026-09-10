"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Button } from "../../primitives/Button/Button";
import { Dialog } from "../../primitives/overlays/Dialog";
import { SearchInput } from "../../primitives/forms/SearchInput";
import { Segment, SegmentedControl } from "../../primitives/controls/Tabs";
import { DropdownMenu, DropdownMenuItem, DropdownSubmenu } from "../../primitives/overlays/Menus";
import { Text } from "../../primitives/typography/Typography";
import { EmptyState } from "../../primitives/feedback/Feedback";
import { cx } from "../../utils/cx";
import { filterCatalogModels, uniqueModelVendors, type CatalogModelOption } from "./model-filters";
import styles from "./chat.module.scss";
import type { AiInteractionMode, AutoEffortLevel } from "./Chat";

export function ModelModeControl({
  mode,
  autoLevel,
  autoEnabled,
  selectedModelLabel,
  autoLabel,
  proLabel,
  minimumLabel,
  mediumLabel,
  maximumLabel,
  autoUnavailableHint,
  onSelectAuto,
  onSelectPro,
}: {
  mode: AiInteractionMode;
  autoLevel: AutoEffortLevel;
  autoEnabled: boolean;
  selectedModelLabel: string;
  autoLabel: string;
  proLabel: string;
  minimumLabel: string;
  mediumLabel: string;
  maximumLabel: string;
  autoUnavailableHint: string;
  onSelectAuto: (level: AutoEffortLevel) => void;
  onSelectPro: () => void;
}): ReactElement {
  const closedLabel =
    mode === "auto" && autoEnabled
      ? `${autoLabel} · ${autoLevel === "minimum" ? minimumLabel : autoLevel === "maximum" ? maximumLabel : mediumLabel}`
      : `${proLabel} · ${selectedModelLabel}`;

  return (
    <DropdownMenu label={closedLabel} variant="secondary">
      <DropdownSubmenu label={autoLabel} disabled={!autoEnabled}>
        <DropdownMenuItem
          onSelect={() => onSelectAuto("minimum")}
          disabled={!autoEnabled}
        >
          {minimumLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onSelectAuto("medium")}
          disabled={!autoEnabled}
        >
          {mediumLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onSelectAuto("maximum")}
          disabled={!autoEnabled}
        >
          {maximumLabel}
        </DropdownMenuItem>
      </DropdownSubmenu>
      {!autoEnabled ? <Text tone="caption">{autoUnavailableHint}</Text> : null}
      <DropdownMenuItem onSelect={onSelectPro}>{proLabel}</DropdownMenuItem>
    </DropdownMenu>
  );
}

export function ModelPickerDialog({
  open,
  onOpenChange,
  title,
  searchLabel,
  allLabel,
  streamingLabel,
  cancelLabel,
  applyLabel,
  emptyLabel,
  closeLabel,
  models,
  selectedId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  searchLabel: string;
  allLabel: string;
  streamingLabel: string;
  cancelLabel: string;
  applyLabel: string;
  emptyLabel: string;
  closeLabel: string;
  models: CatalogModelOption[];
  selectedId: string;
  onApply: (id: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string | "all">("all");
  const [streamingOnly, setStreamingOnly] = useState(false);
  const [draftId, setDraftId] = useState(selectedId);
  const vendors = useMemo(() => uniqueModelVendors(models), [models]);
  const visible = filterCatalogModels(models, query, vendor, streamingOnly);

  useEffect(() => {
    if (open) {
      setDraftId(selectedId);
      setQuery("");
      setVendor("all");
      setStreamingOnly(false);
    }
  }, [open, selectedId]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            onClick={() => {
              onApply(draftId);
              onOpenChange(false);
            }}
            disabled={!draftId}
          >
            {applyLabel}
          </Button>
        </>
      }
    >
      <SearchInput
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.filters}>
        <SegmentedControl label={allLabel}>
          <Segment checked={vendor === "all" && !streamingOnly} onSelect={() => { setVendor("all"); setStreamingOnly(false); }}>
            {allLabel}
          </Segment>
          {vendors.map((item) => (
            <Segment
              key={item}
              checked={vendor === item && !streamingOnly}
              onSelect={() => {
                setVendor(item);
                setStreamingOnly(false);
              }}
            >
              {item}
            </Segment>
          ))}
          <Segment
            checked={streamingOnly}
            onSelect={() => {
              setStreamingOnly(true);
              setVendor("all");
            }}
          >
            {streamingLabel}
          </Segment>
        </SegmentedControl>
      </div>
      {visible.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <div className={styles.pickerList} role="listbox" aria-label={title}>
          {visible.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={draftId === model.id}
              className={cx(styles.pickerItem, draftId === model.id ? styles.pickerItemSelected : undefined)}
              onClick={() => setDraftId(model.id)}
            >
              <span>
                <strong>{model.displayName}</strong>
                <Text tone="caption">{model.vendor}</Text>
              </span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
