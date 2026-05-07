import { describe, expectTypeOf, test } from "vitest";
import { LedgerService } from "./ledger-service.js";
import type { AdminLedger, Ledger, LocalLedger } from "./ledger.js";

describe("Ledger interface hierarchy", () => {
  test("LedgerService satisfies LocalLedger", () => {
    expectTypeOf<LedgerService>().toMatchTypeOf<LocalLedger>();
  });

  test("LocalLedger extends AdminLedger", () => {
    expectTypeOf<LocalLedger>().toMatchTypeOf<AdminLedger>();
  });

  test("AdminLedger extends Ledger", () => {
    expectTypeOf<AdminLedger>().toMatchTypeOf<Ledger>();
  });
});
