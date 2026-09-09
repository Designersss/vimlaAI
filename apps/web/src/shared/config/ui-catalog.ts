export function isUiCatalogEnabled(): boolean {
  return process.env.APP_ENV === "local" || process.env.APP_ENV === "test";
}
