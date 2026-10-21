import { describe, expect, it } from "vitest";
import { getPageItems } from "@/components/kit/components/pager";

describe("getPageItems", () => {
  it("returns the only page for one page", () => {
    expect(getPageItems(1, 1)).toEqual([1]);
  });

  it("returns every page for seven pages", () => {
    expect(getPageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses the tail from the first page of 20", () => {
    expect(getPageItems(1, 20)).toEqual([1, 2, "gap", 20]);
  });

  it("collapses both sides from the middle of 20", () => {
    expect(getPageItems(5, 20)).toEqual([1, "gap", 4, 5, 6, "gap", 20]);
  });

  it("collapses the head from the last page of 20", () => {
    expect(getPageItems(20, 20)).toEqual([1, "gap", 19, 20]);
  });

  it("shows no gap at page 2 of 20", () => {
    expect(getPageItems(2, 20)).toEqual([1, 2, 3, "gap", 20]);
  });

  it("shows no gap at page 19 of 20", () => {
    expect(getPageItems(19, 20)).toEqual([1, "gap", 18, 19, 20]);
  });

  it("shows the number instead of a gap of one page", () => {
    expect(getPageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(getPageItems(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });
});
