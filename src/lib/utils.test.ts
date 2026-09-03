import { describe, expect, it } from "vitest";
// Import przez alias, nie przez ścieżkę względną — to jest przedmiot tego testu:
// dowodzi, że runner rozwiązuje `@/*` tak samo jak build.
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("łączy klasy w jeden ciąg", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("pomija wartości fałszywe", () => {
    expect(cn("px-2", false, null, undefined, "py-1")).toBe("px-2 py-1");
  });

  it("rozstrzyga konflikt Tailwinda na rzecz ostatniej klasy", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
