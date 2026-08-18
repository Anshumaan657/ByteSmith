import { describe, expect, it } from "vitest";
import { formatPayment } from "./format-payment";

describe("formatPayment", () => {
  it("formats amount and currency", () => {
    expect(formatPayment({ id: "p1", amount: 25, currency: "USD" })).toBe("25 USD");
  });
});
