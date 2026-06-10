/**
 * Removes NYC permit-style “Job Filing Number: M0123…” from RSS blurbs
 * (TRD / DOB-style). ID must look like a filing code (M… or long digits), not “New Building”.
 */
const FILING_ID = "(?:M\\d{5,}(?:-[A-Z0-9]+)?|\\d{7,}(?:-[A-Z0-9]+)?)";

export function stripFilingNumberNoise(text) {
  return String(text || "")
    .replace(new RegExp(`(?:Job\\s+)?Filing\\s+Number\\s*:?\\s*(?:\\n\\s*)*${FILING_ID}\\b`, "gi"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
