import { describe, expect, it } from "vitest";
import en from "../../messages/profile-en.json";
import ru from "../../messages/profile-ru.json";
import { collectKeys } from "./message-keys";

describe("profile messages", () => {
  it("keeps English and Russian profile message keys in sync", () => {
    expect(collectKeys(en).sort()).toEqual(collectKeys(ru).sort());
  });
});
