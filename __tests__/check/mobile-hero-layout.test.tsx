import { readFileSync } from "fs";
import { join } from "path";

/*
 * Structural regression checks on the hero's narrow-viewport CSS source.
 *
 * jsdom performs no layout, so nothing here measures a width or claims the
 * page fits a viewport. These tests pin the rules that make it possible: a
 * single hero track that can shrink below its children's min-content, grid
 * children that can shrink, and a status chip whose label wraps rather than
 * being clipped — while the desktop rules stay as they were.
 */

const root = process.cwd();
const css = readFileSync(join(root, "app/ot-design.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function scanMedia(src: string, query: string | null): { blocks: string[]; topLevel: string } {
  const blocks: string[] = [];
  let topLevel = "";
  let i = 0;
  while (true) {
    const at = src.indexOf("@media", i);
    if (at === -1) {
      topLevel += src.slice(i);
      break;
    }
    topLevel += src.slice(i, at);
    const open = src.indexOf("{", at);
    let j = open + 1;
    let depth = 1;
    while (depth > 0 && j < src.length) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const prelude = src.slice(at, open).replace(/\s+/g, " ").trim();
    if (query !== null && prelude === `@media (${query})`) blocks.push(src.slice(open + 1, j - 1));
    i = j;
  }
  return { blocks, topLevel };
}

function bodies(scope: string, selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(m[2] ?? "");
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function declares(scopeBodies: string[], prop: string, value: string): boolean {
  const re = new RegExp(`(^|;)\\s*${escape(prop)}\\s*:\\s*${escape(value)}\\s*(;|$)`);
  return scopeBodies.some((b) => re.test(b));
}

const narrow = scanMedia(css, "max-width: 1100px").blocks.join("\n");
const desktop = scanMedia(css, null).topLevel;

describe("mobile hero layout — CSS source, structural only", () => {
  it("closes the single-column hero track at the existing 1100px breakpoint", () => {
    const split = bodies(narrow, ".ot-hero-inner-split");
    expect(declares(split, "grid-template-columns", "minmax(0, 1fr)")).toBe(true);
    // The bare `1fr` track (implicit `minmax(auto, 1fr)`) is what let the
    // chip's min-content width set the column.
    expect(declares(split, "grid-template-columns", "1fr")).toBe(false);
  });

  it("lets both hero grid children shrink below their min-content width", () => {
    expect(declares(bodies(narrow, ".ot-hero-inner-split > .ot-hero-l"), "min-width", "0")).toBe(true);
    expect(declares(bodies(narrow, ".ot-hero-inner-split > .ot-hero-r"), "min-width", "0")).toBe(true);
  });

  it("wraps the narrow hero status chip instead of clipping or truncating it", () => {
    const chip = bodies(narrow, ".ot-hero-narrative .ot-chip");
    expect(declares(chip, "white-space", "normal")).toBe(true);
    expect(declares(chip, "overflow", "visible")).toBe(true);
    expect(declares(chip, "text-overflow", "clip")).toBe(true);

    const text = bodies(narrow, ".ot-hero-narrative .ot-chip > .ot-chip-text");
    expect(declares(text, "white-space", "normal")).toBe(true);
    expect(declares(text, "min-width", "0")).toBe(true);
    expect(declares(text, "flex", "1 1 auto")).toBe(true);
  });

  it("leaves the desktop hero and chip rules unchanged", () => {
    expect(
      declares(bodies(desktop, ".ot-hero-inner-split"), "grid-template-columns", "minmax(0, 1.5fr) minmax(420px, 1fr)"),
    ).toBe(true);
    const chip = bodies(desktop, ".ot-chip");
    expect(declares(chip, "white-space", "nowrap")).toBe(true);
    expect(declares(chip, "overflow", "hidden")).toBe(true);
    expect(declares(chip, "text-overflow", "ellipsis")).toBe(true);
    expect(declares(bodies(desktop, ".ot-chip > *"), "white-space", "nowrap")).toBe(true);
    // No narrow-only chip override leaks to the top level.
    expect(bodies(desktop, ".ot-hero-narrative .ot-chip > .ot-chip-text")).toHaveLength(0);
  });

  it("targets the real hero chip markup, whose label text is unchanged", () => {
    const home = readFileSync(join(root, "components/ot-design/HomePage.tsx"), "utf8");
    expect(home).toMatch(/<div className="ot-hero-narrative">\s*<StatusChip \/>/);

    const chrome = readFileSync(join(root, "components/ot-design/SiteChrome.tsx"), "utf8");
    expect(chrome).toMatch(
      /className="ot-chip ot-chip-link"[\s\S]*?<span className="ot-chip-text">\s*<span className="ot-chip-label">\s*Township schedules, as published by the county\s*<\/span>/,
    );
  });
});
