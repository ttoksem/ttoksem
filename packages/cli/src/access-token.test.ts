import { describe, it, expect } from "vitest";
import { generateAccessToken, hashAccessToken, tokenPrefix } from "./access-token.js";

describe("access-token helpers", () => {
  it("generateAccessToken returns a ttok_-prefixed token", () => {
    expect(generateAccessToken()).toMatch(/^ttok_[A-Za-z0-9_-]+$/);
  });
  it("generateAccessToken returns a unique token each call", () => {
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });
  it("hashAccessToken returns lowercase 64-char hex", () => {
    expect(hashAccessToken("ttok_example")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("hashAccessToken is deterministic", () => {
    expect(hashAccessToken("ttok_x")).toBe(hashAccessToken("ttok_x"));
  });
  it("tokenPrefix returns the first 16 characters", () => {
    const prefix = tokenPrefix("ttok_abcdefghijklmnop_extra");
    expect(prefix).toBe("ttok_abcdefghijk");
    expect(prefix).toHaveLength(16);
  });
});
