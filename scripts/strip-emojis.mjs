/**
 * Remove emoji / pictographs from plain text (RSS teasers often include 🏆 📊 etc.).
 * Uses Unicode "Extended_Pictographic" — safe in Node 20+ and current browsers as `import`.
 */
export function stripEmojis(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
