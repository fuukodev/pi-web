import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { normalizeSyntaxHighlighterStyle } = await jiti.import("./syntax-highlighter-style.ts");
const lightStyleModule = await jiti.import("react-syntax-highlighter/dist/cjs/styles/prism/vs");
const darkStyleModule = await jiti.import("react-syntax-highlighter/dist/cjs/styles/prism/vsc-dark-plus");
const lightStyle = lightStyleModule.default.default;
const darkStyle = darkStyleModule.default.default;

const preSelector = 'pre[class*="language-"]';

for (const [name, style, expectedBackground] of [
  ["light", lightStyle, "white"],
  ["dark", darkStyle, "#1e1e1e"],
]) {
  test(`normalizes ${name} syntax theme background to one CSS property`, () => {
    const normalized = normalizeSyntaxHighlighterStyle(style);
    const preStyle = normalized[preSelector];

    assert.equal(preStyle.background, undefined);
    assert.equal(preStyle.backgroundColor, expectedBackground);
    assert.equal(style[preSelector].background, name === "dark" ? "#1e1e1e" : undefined);
    assert.equal(style[preSelector].backgroundColor, name === "light" ? "white" : undefined);
  });
}
