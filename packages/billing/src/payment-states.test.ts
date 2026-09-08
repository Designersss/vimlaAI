import { describe, expect, it } from "vitest";
import { nextDomainStatus } from "./payment-states.js";

describe("payment domain transitions", () => {
  it("does not regress SUCCEEDED to PENDING", () => {
    expect(nextDomainStatus("SUCCEEDED", "pending")).toBeNull();
    expect(nextDomainStatus("SUCCEEDED", "failed")).toBeNull();
    expect(nextDomainStatus("SUCCEEDED", "canceled")).toBeNull();
    expect(nextDomainStatus("CREATED", "pending")).toBe("PENDING");
    expect(nextDomainStatus("PENDING", "confirmed")).toBe("SUCCEEDED");
    expect(nextDomainStatus("SUCCEEDED", "confirmed")).toBeNull();
  });
});
