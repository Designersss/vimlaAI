import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./index.js";

describe("createPrismaClient", () => {
  it("constructs a client with an explicit database URL", async () => {
    const client = createPrismaClient(
      "postgresql://vimla:vimla@localhost:5432/vimla",
    );
    expect(client).toBeDefined();
    await client.$disconnect();
  });
});
