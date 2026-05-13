/**
 * @jest-environment node
 */
import { normalizeFreeCheckSearchInput } from "@/lib/free-check-address";

describe("free-check address normalization", () => {
  it("strips city/state/zip from common full Chicago address input", () => {
    expect(normalizeFreeCheckSearchInput("100 W Randolph St, Chicago IL 60601", "")).toEqual({
      address: "100 W Randolph St",
      city: "Chicago",
    });
  });

  it("keeps explicit city field and strips trailing IL zip", () => {
    expect(normalizeFreeCheckSearchInput("100 W Randolph St IL 60601", "Chicago")).toEqual({
      address: "100 W Randolph St",
      city: "Chicago",
    });
  });

  it("handles no-comma Chicago suffix", () => {
    expect(normalizeFreeCheckSearchInput("100 W Randolph St Chicago", "")).toEqual({
      address: "100 W Randolph St",
      city: "Chicago",
    });
  });
});
