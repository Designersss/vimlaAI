export type CatalogModelOption = {
  id: string;
  displayName: string;
  vendor: string;
  supportsStreaming: boolean;
};

export function uniqueModelVendors(models: CatalogModelOption[]): string[] {
  return [...new Set(models.map((model) => model.vendor))].sort();
}

export function filterCatalogModels(
  models: CatalogModelOption[],
  query: string,
  vendor: string | "all",
  streamingOnly: boolean,
): CatalogModelOption[] {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    if (vendor !== "all" && model.vendor !== vendor) {
      return false;
    }
    if (streamingOnly && !model.supportsStreaming) {
      return false;
    }
    if (!normalized) {
      return true;
    }
    return (
      model.displayName.toLowerCase().includes(normalized) || model.vendor.toLowerCase().includes(normalized)
    );
  });
}
