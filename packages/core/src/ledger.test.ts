import { describe, expectTypeOf, test } from "vitest";
import { LedgerService } from "./ledger-service.js";
import type { Ledger } from "./ledger.js";

describe("Ledger interface", () => {
  test("LedgerService satisfies Ledger", () => {
    expectTypeOf<LedgerService>().toMatchTypeOf<Ledger>();
  });
});
