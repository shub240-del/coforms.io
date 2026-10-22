import { describe, expect, it } from "vitest";
import { csvCell, hasResponseValue } from "./responseData";

describe("response data helpers", () => {
  it("counts zero and false as answered values", () => {
    expect(hasResponseValue(0)).toBe(true);
    expect(hasResponseValue(false)).toBe(true);
    expect(hasResponseValue("")).toBe(false);
    expect(hasResponseValue(null)).toBe(false);
  });

  it("treats empty collections as unanswered and populated ones as answered", () => {
    expect(hasResponseValue([])).toBe(false);
    expect(hasResponseValue(["choice"])).toBe(true);
    expect(hasResponseValue({})).toBe(false);
    expect(hasResponseValue({ row: false })).toBe(true);
  });

  it("quotes CSV cells and neutralizes spreadsheet formulas", () => {
    expect(csvCell('safe, "quoted"')).toBe('"safe, ""quoted"""');
    expect(csvCell("=HYPERLINK(\"https://example.invalid\")"))
      .toBe('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(csvCell("  +SUM(A1:A2)")).toBe('"\'  +SUM(A1:A2)"');
    expect(csvCell(0)).toBe('"0"');
  });
});
