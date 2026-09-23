import { describe, it, expect } from "vitest";
import { civilDate, formatCivil, formatInstant, formatMoney, formatQuantity } from "./format";
import { readConfig } from "./config";
import { ApiFailure, errorMessage } from "../api/errors";
describe("format/config/error boundaries", () => {
  it("quantities never silently round an invalid count", () => {
    expect(formatQuantity(1200)).toBe('1.200');
    expect(() => formatQuantity(1.5)).toThrow();
    expect(() => formatQuantity(-1)).toThrow();
    expect(() => formatQuantity(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it.each(["2025-02-29", "2026-13-01", "2026-01-00", "2026-1-1", "invalid"])(
    "rejects invalid civil date %s",
    (value) => expect(() => civilDate(value)).toThrow(),
  );
  it("civil dates never cross day while UTC instants use business timezone", () => {
    expect(formatCivil("2024-02-29")).toBe("29/02/2024");
    expect(
      formatInstant("2026-09-23T01:00:00Z", "America/Argentina/Buenos_Aires"),
    ).toContain("22");
    expect(() => formatInstant("2026-09-23T01:00:00", "UTC")).toThrow();
  });
  it("money formatting is exact and never calculates floats", () => {
    expect(formatMoney("9007199254740993.01")).toBe(
      "$\u00a09.007.199.254.740.993,01",
    );
    expect(formatMoney("0")).toBe("$\u00a00,00");
    expect(() => formatMoney("1.234")).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "https://user:secret@example.test",
    "https://api.test/path",
    "https://api.test/?secret=1",
  ])("rejects unsafe API URL %s", (url) =>
    expect(() => readConfig({ VITE_API_BASE_URL: url })).toThrow(),
  );
  it("requires HTTPS production and an actual IANA timezone", () => {
    expect(() => readConfig({ PROD: true })).toThrow();
    expect(() => readConfig({ VITE_BUSINESS_TIMEZONE: "invented" })).toThrow();
    expect(
      readConfig({ VITE_API_BASE_URL: "https://api.example.test", PROD: true })
        .apiBaseUrl,
    ).toBe("https://api.example.test");
  });
  it("stable codes drive messages, never raw SQL or error.message", () => {
    expect(
      errorMessage(new ApiFailure("http", 409, "CLASS_SESSION_FULL")),
    ).toContain("No quedan lugares");
    expect(
      errorMessage(new Error("SELECT password FROM Session")),
    ).not.toContain("SELECT");
    expect(errorMessage(new ApiFailure("network", 0, "", true))).toContain(
      "confirmar el resultado",
    );
    expect(errorMessage(new ApiFailure("http", 403))).toContain("permiso");
  });
});
