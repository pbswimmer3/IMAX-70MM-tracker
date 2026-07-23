import { describe, it, expect } from "vitest";
import { is70mmFormat } from "@/scraper/parseAmc";

describe("is70mmFormat", () => {
  it("returns true for 'IMAX 70MM'", () => {
    expect(is70mmFormat("IMAX 70MM")).toBe(true);
  });

  it("returns true for '70mm'", () => {
    expect(is70mmFormat("70mm")).toBe(true);
  });

  it("returns true for '70 mm'", () => {
    expect(is70mmFormat("70 mm")).toBe(true);
  });

  it("returns false for 'IMAX at AMC'", () => {
    expect(is70mmFormat("IMAX at AMC")).toBe(false);
  });

  it("returns false for 'Dolby Cinema at AMC'", () => {
    expect(is70mmFormat("Dolby Cinema at AMC")).toBe(false);
  });

  it("returns false for 'RealD 3D'", () => {
    expect(is70mmFormat("RealD 3D")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(is70mmFormat("")).toBe(false);
  });
});
