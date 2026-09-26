const DISPLAY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/twelve hundred fifty dirhams/giu, '1,250 dirhams'],
  [/OPS forty-two/giu, 'OPS-42'],
];

export const formatCaptionText = (text: string): string =>
  DISPLAY_REPLACEMENTS.reduce(
    (formatted, [pattern, replacement]) => formatted.replace(pattern, replacement),
    text.trim(),
  );
