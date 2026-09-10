import { describe, expect, it } from "vitest";
import { deliveryJobId } from "./queue-names.js";

describe("delivery job id", () => {
  it("does not use a colon because BullMQ rejects that in custom ids", () => {
    const id = deliveryJobId("11111111-1111-4111-8111-111111111111");
    expect(id.includes(":")).toBe(false);
    expect(id).toBe("notification-delivery-11111111-1111-4111-8111-111111111111");
  });
});
