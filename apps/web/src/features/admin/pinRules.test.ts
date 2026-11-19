import { describe, expect, it } from "vitest";
import { isWeakPin } from "./pinRules";

// Mesmas listas de apps/api/tests/auth/test_auth.py (a regra é a mesma nos dois lados).
describe("isWeakPin", () => {
  it.each([
    "000000", "111111", "999999",
    "123456", "234567", "456789", "012345", "890123",
    "654321", "987654", "543210", "210987",
    "121212", "909090", "123123", "112112",
    "112233", "123321", "147258", "159753", "102030",
  ])("%s é fácil", (pin) => expect(isWeakPin(pin)).toBe(true));

  it.each(["246810", "739104", "580317", "120458", "903712"])("%s não é fácil", (pin) =>
    expect(isWeakPin(pin)).toBe(false),
  );
});
