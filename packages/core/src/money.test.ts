import { describe, expect, it } from "vitest";
import { decimalToNanos, nanosToDecimal } from "./money.js";

describe("money conversion", () => {
  it("stores decimal currency as integer nanos", () => {
    expect(decimalToNanos(0.42)).toBe(420_000_000);
    expect(nanosToDecimal(10_000_000)).toBe(0.01);
  });

  it("keeps nullable money empty", () => {
    expect(decimalToNanos(null)).toBeNull();
    expect(decimalToNanos(undefined)).toBeNull();
  });
});

