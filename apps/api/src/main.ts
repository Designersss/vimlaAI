import "reflect-metadata";
import { loadApiConfig } from "@vimla/config/server";
import { createVimlaApiApp } from "./create-app.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await createVimlaApiApp(config);
  await app.listen(config.port, config.host);
}

await bootstrap();
