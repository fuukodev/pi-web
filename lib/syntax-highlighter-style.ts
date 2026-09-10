import type { SyntaxHighlighterProps } from "react-syntax-highlighter";

const PRE_STYLE_SELECTOR = 'pre[class*="language-"]';
type SyntaxHighlighterStyle = NonNullable<SyntaxHighlighterProps["style"]>;

/**
 * Keep the highlighter's root background on one CSS property.
 *
 * The bundled light theme uses `backgroundColor` while the dark theme uses
 * the shorthand `background`. React warns when either theme is merged with a
 * custom background or when the theme changes between renders.
 */
export function normalizeSyntaxHighlighterStyle(style: SyntaxHighlighterStyle): SyntaxHighlighterStyle {
  const preStyle = style[PRE_STYLE_SELECTOR];
  if (!preStyle?.background) return style;

  const { background, ...withoutBackground } = preStyle;
  return {
    ...style,
    [PRE_STYLE_SELECTOR]: {
      ...withoutBackground,
      ...(withoutBackground.backgroundColor === undefined ? { backgroundColor: String(background) } : {}),
    },
  };
}
