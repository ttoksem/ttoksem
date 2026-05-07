import { describe, expectTypeOf, test } from "vitest";
import type { Ledger } from "@ttoksem/core";
import { HttpLedgerClient } from "./client.js";

describe("HttpLedgerClient type conformance", () => {
  test("HttpLedgerClient satisfies Ledger", () => {
    expectTypeOf<HttpLedgerClient>().toMatchTypeOf<Ledger>();
  });
});
