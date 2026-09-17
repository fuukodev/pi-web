import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const source = await readFile(new URL("./ConfigSelect.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ConfigSelect } = await jiti.import("./ConfigSelect.tsx");

const OPTIONS = [
  { value: "off", label: "off", description: "Reasoning off" },
  { value: "high", label: "high", description: "High reasoning" },
];

test("renders a field trigger that matches the model selector surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(ConfigSelect, {
      value: "high",
      options: OPTIONS,
      onChange() {},
      ariaLabel: "Default thinking level",
      icon: React.createElement("svg", { "data-testid": "icon" }),
    }),
  );

  assert.match(html, /class="config-select-field"/);
  assert.match(html, /class="config-select-button"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Default thinking level"/);
  assert.match(html, /class="config-select-value">high</);
  assert.match(html, /class="config-select-chevron"/);
  assert.match(html, /data-testid="icon"/);
  // Closed state must not render options, and must not be a native select.
  assert.doesNotMatch(html, /role="listbox"/);
  assert.doesNotMatch(html, /<select/);

  // Same geometry tokens as the ModelSelector field variant it sits beside.
  assert.match(cssSource, /\.config-select-button \{[\s\S]*?height: 34px[\s\S]*?padding: 0 9px[\s\S]*?background: var\(--bg\)/);
  assert.match(cssSource, /\.config-select-chevron \{/);
});

test("keeps the native control's dismissal and keyboard contract", () => {
  // Escape closes only the menu: the settings dialog listens on document for
  // Escape and must see this event as already handled.
  assert.match(source, /event\.key === "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?setOpen\(false\)/);
  assert.match(source, /event\.key === "Tab"[\s\S]*?setOpen\(false\)/);
  assert.match(source, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(source, /document\.addEventListener\("mousedown", handleOutsideClick\)/);
  assert.match(source, /aria-selected=\{active\}/);
  // Focus the current option once per open, not on every parent render.
  assert.match(source, /\}, \[open\]\);/);
  assert.doesNotMatch(source, /\}, \[open, options, value\]\);/);
});

test("describes each option with the app's level label", () => {
  const html = renderToStaticMarkup(
    React.createElement(ConfigSelect, {
      value: "off",
      options: OPTIONS,
      onChange() {},
      ariaLabel: "Default thinking level",
    }),
  );

  // Closed: only the value shows.
  assert.match(html, /class="config-select-value">off</);
  assert.doesNotMatch(html, /High reasoning/);

  assert.match(source, /option\.description && \(/);
  assert.match(cssSource, /\.config-select-option-description \{[\s\S]*?text-align: right/);
});
