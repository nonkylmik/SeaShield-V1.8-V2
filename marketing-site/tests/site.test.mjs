// Page integrity: links, assets, accessibility basics, simulated-data disclosures, claims and contrast.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveRequest } from "../scripts/serve.mjs";

const site = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(site(path), "utf8");
const PAGES = ["index.html", "privacy.html"];
const index = read("index.html");
const visibleText = (html) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

test("every in-page link points to an existing id", () => {
  for (const page of PAGES) {
    const html = read(page);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, target] of html.matchAll(/href="#([^"]*)"/g)) {
      assert.ok(ids.has(target), `${page}: #${target} has no matching id`);
    }
  }
});

test("every local file the pages and stylesheet reference exists", () => {
  const refs = [];
  for (const page of PAGES) {
    const html = read(page);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) refs.push([page, ref]);
    for (const [, set] of html.matchAll(/srcset="([^"]+)"/g))
      for (const part of set.split(",")) refs.push([page, part.trim().split(/\s+/)[0]]);
  }
  for (const [, ref] of read("styles.css").matchAll(/url\("\.\/([^"]+)"\)/g))
    refs.push(["styles.css", ref]);
  assert.ok(refs.length > 10);
  for (const [from, ref] of refs) assert.ok(existsSync(site(ref)), `${from}: missing ${ref}`);
});

test("no page or stylesheet loads anything from another origin", () => {
  for (const file of [...PAGES, "styles.css", "main.js", "form.js", "config.js"]) {
    const text = read(file);
    assert.doesNotMatch(text, /(?:src|href|srcset|url\()\s*=?\s*["(]?\s*(?:https?:)?\/\//, file);
  }
  assert.match(index, /http-equiv="Content-Security-Policy"[^>]+default-src 'self'/);
});

/** Width and height of a WebP file (lossy, lossless or extended). */
function webpSize(path) {
  const b = readFileSync(site(path));
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  throw new Error(`${path}: unknown WebP chunk ${chunk}`);
}

test("images have alt text and their real dimensions, so the layout does not shift", () => {
  const images = [...index.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(images.length >= 2);
  for (const img of images) {
    const attr = (name) => img.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    assert.ok(attr("alt") && attr("alt").length > 20, `alt text: ${img.slice(0, 60)}`);
    assert.deepEqual(
      webpSize(attr("src")),
      [Number(attr("width")), Number(attr("height"))],
      attr("src"),
    );
  }
  assert.deepEqual(webpSize("assets/screens/map-800.webp"), [800, 500]);
});

test("every screenshot carries a simulated-data disclosure in its own caption", () => {
  const figures = [...index.matchAll(/<figure[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  assert.ok(figures.length >= 2);
  for (const figure of figures) {
    assert.match(figure, /<figcaption>[\s\S]*class="disclosure"[\s\S]*simulated/i);
  }
  assert.match(
    index,
    /Prototype preview — vessel positions and operational data may be simulated\./,
  );
});

test("form controls have labels and error slots", () => {
  for (const [, id] of index.matchAll(/<(?:input|textarea)\b[^>]*\sid="([^"]+)"/g)) {
    assert.match(index, new RegExp(`<label for="${id}"`), `label for #${id}`);
    if (id !== "website")
      assert.match(index, new RegExp(`id="${id}-error"`), `error slot for #${id}`);
  }
  assert.match(index, /<form id="lead-form"/);
  assert.match(index, /role="status"/);
});

test("the copy makes no unsupported claims", () => {
  const text = visibleText(index).toLowerCase();
  const forbidden = [
    "real-time",
    "real time",
    "live tracking",
    "satellite",
    "ai-powered",
    "artificial intelligence",
    "machine learning",
    "certified",
    "compliant",
    "guarantee",
    "trusted by",
    "customers include",
    "testimonial",
    "24/7",
  ];
  for (const phrase of forbidden) assert.ok(!text.includes(phrase), `"${phrase}"`);
  // AIS appears only as something the prototype does not use yet.
  for (const [sentence] of text.matchAll(/[^.]*\bais\b[^.]*\./g)) {
    assert.match(sentence, /\b(not|no|planned|such as)\b/, sentence);
  }
  assert.match(text, /does the current map use live ais data\? no\./);
});

test("planned integrations are marked as planned, not available", () => {
  const panels = index.split('class="status-panel"');
  const available = visibleText(panels[1]).toLowerCase();
  const planned = visibleText(panels[2]).toLowerCase();
  assert.match(available, /available · simulated data/);
  assert.match(planned, /planned/);
  for (const integration of ["cctv", "sensor", "access control", "cyber security"]) {
    assert.ok(planned.includes(integration), `planned: ${integration}`);
    assert.ok(!available.includes(integration), `not listed as available: ${integration}`);
  }
});

test("the privacy page is a marked draft that names what is still missing", () => {
  const privacy = read("privacy.html");
  assert.match(privacy, /<meta name="robots" content="noindex"/);
  assert.match(visibleText(privacy), /Draft — not yet in effect\./);
  assert.match(visibleText(privacy), /the form is not connected/);
  for (const missing of ["legal name", "contact email", "Legal basis", "retention period"]) {
    assert.ok(privacy.includes(missing), missing);
  }
});

/** WCAG 2 contrast ratio between two hex colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("text and accent colours meet WCAG AA contrast on both backgrounds", () => {
  const css = read("styles.css");
  const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))[1];
  const backgrounds = ["navy", "steel"];
  for (const fg of ["grey", "muted", "cyan", "caution", "danger"]) {
    for (const bg of backgrounds) {
      const ratio = contrast(token(fg), token(bg));
      assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
    }
  }
  assert.ok(contrast(token("ink-on-cyan"), token("cyan")) >= 4.5, "button text on cyan");
});

test("the preview server serves only the site's own files", () => {
  assert.ok(resolveRequest("/")?.endsWith("index.html"));
  assert.ok(resolveRequest("/assets/screens/map-800.webp"));
  for (const path of [
    "/../package.json",
    "/%2e%2e/README.md",
    "/package.json",
    "/tests/site.test.mjs",
    "/scripts/serve.mjs",
    "/..%5c..%5cbackend",
  ]) {
    assert.equal(resolveRequest(path), null, path);
  }
});
