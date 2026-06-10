/**
 * Builds section_overviews text: one paragraph per story from RSS teasers
 * (not headline lists). Keys are outlet slugs (see sourceSectionSlug). Used by
 * build-digest.mjs and refresh-overviews.mjs.
 */

import { stripEmojis } from "./strip-emojis.mjs";
import { stripFilingNumberNoise } from "./strip-filing-noise.mjs";

const OVERVIEW_TEASER_MAX_CHARS = 320;
const OVERVIEW_ITEMS_PER_SECTION = 4;
const OVERVIEW_SENTENCES_PER_ITEM = 2;

/** Stable key for JSON + DOM ids — must match app.js `sourceSectionSlug`. */
export function sourceSectionSlug(source) {
  const s = String(source || "source").trim().toLowerCase();
  const x = s
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return x || "source";
}

function smartTruncate(text, max = OVERVIEW_TEASER_MAX_CHARS) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentenceCut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceCut >= Math.floor(max * 0.55)) {
    return window.slice(0, sentenceCut + 1).trim();
  }
  const wordCut = window.lastIndexOf(" ");
  if (wordCut >= Math.floor(max * 0.7)) {
    return `${window.slice(0, wordCut).trim()}.`;
  }
  return `${window.trim()}.`;
}

function isBoilerplateParagraph(t) {
  const s = String(t || "").trim();
  if (!s) return true;
  if (/^(?:Job\s+)?Filing\s+Number\s*:?\s*$/i.test(s)) return true;
  if (/^[A-Z]\d{6,}-[A-Z0-9.-]+$/i.test(s)) return true;
  return (
    /^Notable figure in the item:/i.test(s) ||
    /^Names \/ firms to watch:/i.test(s) ||
    /^Key names are in the headline/i.test(s) ||
    /^Retail lens:/i.test(s) ||
    /^The post .+ appeared first on /i.test(s) ||
    /^Publisher teaser not in the feed/i.test(s) ||
    /sign up to get early access/i.test(s) ||
    /this story gives you a peek/i.test(s) ||
    /in this edition we mention/i.test(s) ||
    /he wrote the book on real estate law/i.test(s) ||
    /wanting to be the first in his family/i.test(s)
  );
}

function stripFeedFooters(s) {
  return String(s || "")
    .replace(/[ \t]*The post .+? appeared first on PincusCo[ \t]*\.?[ \t]*/gi, " ")
    .replace(/[ \t]*The post .+? appeared first on [^.]+[ \t]*\.?[ \t]*/gi, " ")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function splitIntoSemanticChunks(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const blocks = raw.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      if (!isBoilerplateParagraph(block)) out.push(block);
      continue;
    }
    const buf = [];
    for (const line of lines) {
      if (isBoilerplateParagraph(line)) {
        if (buf.length) out.push(buf.join(" "));
        buf.length = 0;
      } else {
        buf.push(line);
      }
    }
    if (buf.length) out.push(buf.join(" "));
  }
  return out.length ? out : (raw ? [raw] : []);
}

export function cleanTeaserForOverview(summary) {
  const raw = stripFilingNumberNoise(stripEmojis(stripFeedFooters(String(summary || "").trim())));
  if (!raw) return "";
  const parts = splitIntoSemanticChunks(raw).map((p) => stripFeedFooters(p)).filter(Boolean);
  const kept = [];
  for (const p of parts) {
    if (isBoilerplateParagraph(p)) continue;
    kept.push(p);
  }
  if (!kept.length) return "";
  let merged = kept.join(" ");
  merged = stripFeedFooters(merged);
  merged = merged.replace(/\u2026|\.{3,}/g, "");
  if (merged && !/[.!?]["']?\s*$/.test(merged)) {
    merged = `${merged}.`;
  }
  return smartTruncate(merged, OVERVIEW_TEASER_MAX_CHARS);
}

function sentenceChunks(text) {
  return String(text || "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLowSignalSentence(s) {
  return /\b(sign up to get early access|this story gives you a peek|in this edition we mention|wanting to be the first in his family|young [A-Z][a-z]+)\b/i.test(
    String(s || "")
  );
}

function cleanHeadlineForOverview(headline) {
  return String(headline || "Untitled")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphForItem(item) {
  const head = cleanHeadlineForOverview(item.headline);
  const teaser = cleanTeaserForOverview(item.summary);
  if (!teaser) return `${head}.`;
  const picked = [];
  for (const bit of sentenceChunks(teaser)) {
    if (isLowSignalSentence(bit)) continue;
    picked.push(bit);
    if (picked.length >= OVERVIEW_SENTENCES_PER_ITEM) break;
  }
  if (!picked.length) return `${head}.`;
  const text = picked.join(" ");
  return `${head}: ${text}`;
}

function thoroughBodyFromList(list) {
  const slice = (list || []).slice(0, OVERVIEW_ITEMS_PER_SECTION);
  if (!slice.length) {
    return "Public feed teasers in this window are thin, so open the full source links for deeper detail.";
  }
  return slice.map((item) => paragraphForItem(item)).join("\n\n");
}

function buildOutletOverview(slug, list) {
  if (!list.length) {
    return "Nothing from this outlet in this time window.";
  }
  return thoroughBodyFromList(list);
}

export function buildOverviews(items) {
  const slugs = [...new Set((items || []).map((i) => sourceSectionSlug(i.source)))];
  slugs.sort((a, b) => a.localeCompare(b));
  const out = {};
  for (const slug of slugs) {
    const list = (items || []).filter((i) => sourceSectionSlug(i.source) === slug);
    out[slug] = buildOutletOverview(slug, list);
  }
  return out;
}
