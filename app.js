import { stripEmojis } from "./scripts/strip-emojis.mjs";
import { stripFilingNumberNoise } from "./scripts/strip-filing-noise.mjs";
import { sourceSectionSlug } from "./scripts/section-overviews.mjs";

const HIGHLIGHT_LEDE_MAX = 260;

let currentDigest = null;
/** Global outlet filter (synced with top nav source buttons). */
let activeSourceFilter = "";

/** Articles with `published_at` within this window get a “New” badge (browser-local clock). */
const DIGEST_NEW_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function storyPublishedMs(item) {
  const raw = item?.published_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortDigestItemsByNewest(items) {
  return [...(items || [])].sort((a, b) => storyPublishedMs(b) - storyPublishedMs(a));
}

function isDigestItemNew(item) {
  const t = storyPublishedMs(item);
  if (!t || t > Date.now()) return false;
  return Date.now() - t <= DIGEST_NEW_MAX_AGE_MS;
}

function groupBySource(items) {
  const map = new Map();
  for (const item of items || []) {
    const label = String(item.source || "Source").trim() || "Source";
    const key = sourceSectionSlug(label);
    if (!map.has(key)) map.set(key, { key, label, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()]
    .map((row) => ({ ...row, items: sortDigestItemsByNewest(row.items) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Same URL key as `scripts/build-digest.mjs` dedupeKey — keeps retail strip and main list disjoint. */
function storyDedupeKey(item) {
  const raw = String(item?.url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return raw;
  }
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateHighlightLede(text, max = HIGHLIGHT_LEDE_MAX) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > max * 0.65 ? cut.slice(0, lastSpace) : cut).trim();
  return base.endsWith(".") ? base : `${base}…`;
}

/** Drop syndication junk and auto-generated tags from a story teaser. */
function cleanSummaryForSpeech(summary) {
  let s = stripFilingNumberNoise(stripEmojis(String(summary || "").trim()));
  if (!s) return "";
  s = s.replace(/[ \t]*The post .+? appeared first on PincusCo[ \t]*\.?[ \t]*/gi, " ");
  s = s.replace(/[ \t]*The post .+? appeared first on [^.]+[ \t]*\.?[ \t]*/gi, " ");
  const chunks = s
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (
        /^Notable figure in the item:/i.test(p) ||
        /^Names \/ firms to watch:/i.test(p) ||
        /^Key names are in the headline/i.test(p) ||
        /^Retail lens:/i.test(p) ||
        /^The post .+ appeared first on /i.test(p) ||
        /^Publisher teaser not in the feed/i.test(p)
      ) {
        return false;
      }
      return true;
    });
  s = chunks.join(" ").replace(/[^\S\n]+/g, " ").trim();
  if (s.length > 520) {
    s = `${s.slice(0, 519).trim()}…`;
  }
  return s;
}

/** Headline + teaser row: opens preview modal; full article from link inside modal. */
function renderHighlightRow(item) {
  const safeUrl = item.url ? escapeAttr(String(item.url).trim()) : "";
  const headlinePlain = stripEmojis(item.headline || "Untitled");
  const headline = escapeHtml(headlinePlain);
  const headlineAttr = escapeAttr(headlinePlain);
  const srcRaw = String(item.source || "Source").trim() || "Source";
  const source = escapeHtml(srcRaw);
  const summaryForModal = cleanSummaryForSpeech(item.summary || "");
  const summaryAttr = escapeAttr(summaryForModal || "No summary available in this feed.");
  const ledeRaw = truncateHighlightLede(summaryForModal);
  const lede = ledeRaw ? escapeHtml(ledeRaw) : "";
  const isNew = isDigestItemNew(item);
  const retailBadge = item.retail ? `<span class="source-row-retail">NY Retail</span>` : "";
  const newBadge = isNew
    ? `<span class="source-row-new" aria-label="Published in the last 48 hours">New</span>`
    : "";

  return `
    <li class="source-row source-row--highlight${isNew ? " source-row--is-new" : ""}" data-source="${escapeAttr(srcRaw)}">
      <button
        type="button"
        class="source-row-card source-row-toggle"
        data-article-headline="${headlineAttr}"
        data-article-source="${escapeAttr(srcRaw)}"
        data-article-summary="${summaryAttr}"
        data-article-url="${safeUrl || "#"}"
        aria-label="${escapeAttr(`Preview: ${headlinePlain} (${srcRaw})`)}"
      >
        <div class="source-row-card-body">
          <span class="source-row-headline">${headline}</span>
          ${lede ? `<p class="source-row-lede">${lede}</p>` : ""}
        </div>
        <div class="source-row-card-meta">
          <span class="source-row-pub">${source}</span>
          ${newBadge}
          ${retailBadge}
          <span class="source-row-preview-hint" aria-hidden="true">Preview</span>
        </div>
      </button>
    </li>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Split long overview paragraphs on sentence boundaries where feeds glue
 * mini-labels (“New Building: …”, “Job Filing Number: …”) after a full stop.
 */
function expandOverviewBodyToChunks(body) {
  const blocks = String(body || "")
    .trim()
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  /** After a full stop: “…program. New Building: The …” */
  const splitAfterStop = /(?<=[.!?…])\s+(?=(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){1,3}:\s)/;
  /** Mid-line filing IDs etc.: “…M01382130-I1 New Building: In the …” */
  const splitInlineLabel = /(?<=[A-Za-z0-9])\s+(?=(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){1,3}:\s)/;
  const out = [];
  for (const block of blocks) {
    let pieces = [block];
    const runSplit = (re, minLen) => {
      const next = [];
      for (const p of pieces) {
        if (p.length >= minLen) {
          next.push(...p.split(re).map((s) => s.trim()).filter(Boolean));
        } else {
          next.push(p);
        }
      }
      pieces = next;
    };
    runSplit(splitAfterStop, 320);
    runSplit(splitInlineLabel, 200);
    out.push(...pieces);
  }
  return out;
}

/** One visual row under a bucket subhead; optional leading “Label:” from RSS as a kicker. */
function sectionHeroBitHtml(bit) {
  const line = String(bit || "").trim();
  if (!line) return "";
  const lead = /^((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){0,3}):\s+(\S[\s\S]*)$/;
  const m = line.match(lead);
  if (m) {
    const kicker = m[1];
    const rest = m[2];
    return `<p class="section-hero-bit section-hero-bit--lead"><span class="section-hero-kicker">${escapeHtml(kicker)}:</span><span class="section-hero-bit-rest">${escapeHtml(rest).replace(/\n/g, "<br />")}</span></p>`;
  }
  return `<p class="section-hero-bit">${escapeHtml(line).replace(/\n/g, "<br />")}</p>`;
}

const BULLET_MAX_CHARS = 190;
const BULLET_MIN_IMPORTANT_LEN = 42;
const BULLET_MIN_PER_BLOCK = 5;
const BULLET_MAX_PER_BLOCK = 8;

function wrapTextForBullets(text, maxChars = BULLET_MAX_CHARS) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Don’t end a “sentence” on decimals: $29.2M, 3.5%, 1.2 million, etc. */
function splitSentencesForBullets(body) {
  let s = String(body || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const held = [];
  let i = 0;
  const tuck = (re) => {
    s = s.replace(re, (m) => {
      held.push(m);
      return `\uE000${i++}\uE001`;
    });
  };
  tuck(/\$\d+\.\d*/g);
  tuck(/\b\d+\.\d+\s*(?:million|billion|trillion|thousand|M|B|K)\b/gi);
  tuck(/\b\d+\.\d+%/g);
  const parts = s
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => {
    let out = p;
    for (let j = 0; j < held.length; j++) {
      out = out.replace(`\uE000${j}\uE001`, held[j]);
    }
    return out.replace(/\s+/g, " ").trim();
  });
}

function isJunkOverviewSentence(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  const low = t.toLowerCase();
  if (/^sources blended:?/i.test(t)) return true;
  if (/\bsources blended\b/i.test(t) && /\boutlets?\b/i.test(low)) return true;
  if (/^and \d+ more outlets\.?$/i.test(t)) return true;
  if (/trd policy pro|peek at the content coming to our new platform/i.test(low)) return true;
  if (/this story gives you a peek/i.test(low)) return true;
  if (/sign up (to get|for) early access/i.test(low)) return true;
  if (/have a tip or feedback|reach me at /i.test(low)) return true;
  if (/\bwe heard\b/i.test(low)) return true;
  if (/click here to read the full story/i.test(low)) return true;
  if (/the post .+ appeared first on /i.test(low)) return true;
  if (/this article originally appeared on /i.test(low)) return true;
  if (/^(hi there,|let’s get into today’s news)/i.test(t)) return true;
  if (/\bin this edition we mention:/i.test(low)) return true;
  return false;
}

function concreteInfoScore(text) {
  const t = String(text || "");
  let s = 0;
  if (/\$|\bmillion\b|\bbillion\b|\btrillion\b|\d{1,3}(?:,\d{3})+/.test(t)) s += 2.2;
  if (/\b(LLC|Inc\.|Ltd\.|LP|LLP|Corp\.|paid|leased|entity|through the entity)\b/i.test(t)) s += 1.2;
  return s;
}

function isWeakVibesOnly(text) {
  const t = String(text || "");
  if (!/\b(symbol of|just how insane)\b/i.test(t)) return false;
  return concreteInfoScore(t) < 1.5;
}

function sentenceScore(text, idx) {
  let score = 0;
  if (idx === 0) score += 0.2;
  if (/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\s*(?:million|billion)\b|\$\d/i.test(text)) score += 2.7;
  if (/\b(LLC|Inc\.|Ltd\.|LP|LLP|Corp\.|paid|leased|sold|bought|acquire[sd]?|entity|through the entity)\b/i.test(text))
    score += 1.8;
  if (/[$€£¥]|%|\bmillion\b|\bbillion\b|\btrillion\b/i.test(text)) score += 1.6;
  if (/\b(lease|sale|funding|lawsuit|vote|approved|delayed|surge[sd]?|warned|deal|contract|board|authority|founded|reaching|reached)\b/i.test(text))
    score += 1.3;
  if (/^(market context|top deals|what matters next|campaigns & power)[:\s]/i.test(text)) score -= 2.2;
  if (/^(there are certain milestones|a century in business is rare)/i.test(text)) score -= 1.5;
  if (/\b(latest symbol of|just how insane|peek at|gives you a peek)\b/i.test(text)) score -= 2.4;
  if (/\b(this article originally appeared|sign up|have a tip|click here|read the full story|in this edition|publisher teaser)\b/i.test(text))
    score -= 3.2;
  if (text.length < BULLET_MIN_IMPORTANT_LEN && concreteInfoScore(text) < 1.4) score -= 1.2;
  if (text.length > BULLET_MAX_CHARS + 60) score -= 0.7;
  return score;
}

function normalizeForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function oneLineBullet(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\.\.\.+/g, "")
    .trim()
    .replace(/[;:,]$/, "");
  if (!clean) return "";
  const wrapped = wrapTextForBullets(clean, BULLET_MAX_CHARS);
  return wrapped[0] || clean;
}

function selectKeyBulletsFromText(text) {
  let clean = splitSentencesForBullets(text)
    .map((s) => String(s || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((s) => !isJunkOverviewSentence(s));
  const bestConcrete = Math.max(0, ...clean.map((s) => concreteInfoScore(s)));
  if (bestConcrete >= 2) {
    clean = clean.filter((s) => !isWeakVibesOnly(s));
  }
  if (!clean.length) return [];

  const ranked = clean
    .map((candidate, idx) => ({ idx, text: candidate, score: sentenceScore(candidate, idx) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
  const positive = ranked.filter((r) => r.score > 0.2);
  const pool = positive.length ? positive : ranked.slice(0, Math.min(BULLET_MAX_PER_BLOCK, ranked.length));
  const desired = Math.min(BULLET_MAX_PER_BLOCK, Math.max(BULLET_MIN_PER_BLOCK, Math.min(6, pool.length)));
  const picked = pool
    .slice(0, desired)
    .sort((a, b) => a.idx - b.idx)
    .map((r) => oneLineBullet(r.text))
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const line of picked) {
    const k = normalizeForDedupe(line);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  if (out.length) return out;
  const fallback = oneLineBullet(clean[0] || "");
  return fallback ? [fallback] : [];
}

function bulletsForHeroChunks(chunks) {
  const text = chunks
    .map((c) => String(c || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const out = selectKeyBulletsFromText(text);
  if (out.length) return out;
  const fallback = chunks
    .map((c) => String(c).replace(/\s+/g, " ").trim())
    .find((c) => c && !isJunkOverviewSentence(c));
  return fallback ? [oneLineBullet(fallback)].filter(Boolean) : [];
}

function sectionHeroBitLi(bit) {
  const line = String(bit || "").trim();
  if (!line) return "";
  const oneLine = escapeHtml(line).replace(/\n/g, " ");
  const lead = /^((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){0,3}):\s+(\S[\s\S]*)$/;
  const m = line.match(lead);
  if (m) {
    const kicker = m[1];
    const rest = escapeHtml(m[2]).replace(/\n/g, " ");
    return `<li class="section-hero-li section-hero-li--lead"><span class="section-hero-kicker">${escapeHtml(kicker)}:</span><span class="section-hero-li-rest">${rest}</span></li>`;
  }
  return `<li class="section-hero-li">${oneLine}</li>`;
}

function renderSectionHeroPlain(sectionKey, text, heroStyle, atAGlanceTitle) {
  if (!text || !String(text).trim()) return "";
  const hs = heroStyle === "bullets" ? "bullets" : "paragraphs";
  const title =
    atAGlanceTitle && String(atAGlanceTitle).trim()
      ? `${String(atAGlanceTitle).trim()} — at a glance`
      : "At a glance";
  const paras = stripFilingNumberNoise(stripEmojis(String(text)))
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^([A-Za-z][A-Za-z &/]+):\n([\s\S]+)$/);
      if (m) {
        const chunks = expandOverviewBodyToChunks(m[2]);
        if (hs === "bullets") {
          const bullets = bulletsForHeroChunks(chunks);
          const lis = bullets.map(sectionHeroBitLi).filter(Boolean).join("");
          return `<div class="section-hero-bucket"><h4 class="section-hero-subhead">${escapeHtml(m[1])}</h4><ul class="section-hero-bullets" role="list">${lis}</ul></div>`;
        }
        const inner = chunks.map(sectionHeroBitHtml).join("");
        return `<div class="section-hero-bucket"><h4 class="section-hero-subhead">${escapeHtml(m[1])}</h4>${inner}</div>`;
      }
      if (hs === "bullets") {
        const chunks = expandOverviewBodyToChunks(p);
        const bullets = bulletsForHeroChunks(chunks);
        const lis = bullets.map(sectionHeroBitLi).filter(Boolean).join("");
        return `<ul class="section-hero-bullets section-hero-bullets--standalone" role="list">${lis}</ul>`;
      }
      return `<p class="section-hero-plain">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");
  return `
    <div class="section-hero" data-hero-style="${escapeAttr(hs)}">
      <h3 class="section-hero-title">${escapeHtml(title)}</h3>
      <div class="section-hero-body">${paras}</div>
    </div>
  `;
}

function sectionHeroIntroParagraphHtml(overviewText) {
  const parts = stripEmojis(String(overviewText || ""))
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0];
  const isIntro =
    /^Below, each paragraph is one story/i.test(first) ||
    /^Each paragraph is one business story/i.test(first) ||
    /^These notes synthesize/i.test(first);
  if (!isIntro) return "";
  return `<p class="section-hero-intro">${escapeHtml(first).replace(/\n/g, "<br />")}</p>`;
}

const SECTION_HERO_SNIP_MAX = 280;

/**
 * Read view: “at a glance” — headline, em dash, full outlet name linked to the article.
 */
function renderSectionHeroWithLinks(sectionKey, overviewText, secItems, atAGlanceTitle) {
  const title =
    atAGlanceTitle && String(atAGlanceTitle).trim()
      ? `${String(atAGlanceTitle).trim()} — at a glance`
      : "At a glance";
  let bodyInner = sectionHeroIntroParagraphHtml(overviewText);
  for (const item of secItems) {
    const head = escapeHtml(stripEmojis(item.headline || "Untitled"));
    const outlet = outletSourceLinkHtml(item.source, item.url);
    const snipRaw = cleanSummaryForSpeech(item.summary || "");
    const snipEsc = snipRaw
      ? escapeHtml(truncatePlain(snipRaw, SECTION_HERO_SNIP_MAX))
      : "";
    bodyInner += `<p class="section-hero-story"><span class="section-hero-head">${head}</span><span class="section-hero-dash"> — </span>${outlet}.`;
    if (snipEsc) bodyInner += ` ${snipEsc}`;
    bodyInner += `</p>`;
  }
  return `
    <div class="section-hero">
      <h3 class="section-hero-title">${escapeHtml(title)}</h3>
      <div class="section-hero-body">${bodyInner}</div>
    </div>
  `;
}

function uniqueSourcesFromItems(items) {
  const set = new Set();
  for (const it of items || []) {
    const s = String(it.source || "").trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function renderNavSources(digest) {
  const ul = document.getElementById("site-nav-sources");
  if (!ul) return;
  const sources = uniqueSourcesFromItems(digest.items || []);
  const want = activeSourceFilter;
  const lis = [
    `<li><button type="button" class="site-nav-source" data-nav-source="" aria-pressed="${!want ? "true" : "false"}">All</button></li>`,
    ...sources.map((s) => {
      const on = s === want;
      return `<li><button type="button" class="site-nav-source" data-nav-source="${escapeAttr(s)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(s)}</button></li>`;
    }),
  ];
  ul.innerHTML = lis.join("");
}

function initNavSourcesNav() {
  const ul = document.getElementById("site-nav-sources");
  if (!ul || ul.dataset.bound === "1") return;
  ul.dataset.bound = "1";
  ul.addEventListener("click", (e) => {
    const btn = e.target.closest("button.site-nav-source");
    if (!btn) return;
    const raw = btn.getAttribute("data-nav-source");
    const source = raw == null ? "" : raw;
    const mainEl = document.getElementById("digest-main");
    if (!mainEl) return;
    applyGlobalSourceFilter(mainEl, source);
    document.getElementById("digest-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function applySectionSourceFilter(sectionEl, value) {
  const rows = sectionEl.querySelectorAll(".source-row");
  let visible = 0;
  const want = String(value || "").trim();
  rows.forEach((li) => {
    const rowSource = String(li.getAttribute("data-source") || "").trim();
    const match = !want || rowSource === want;
    li.hidden = !match;
    if (match) visible += 1;
  });
  return visible;
}

function applyGlobalSourceFilter(mainEl, value) {
  activeSourceFilter = String(value || "").trim();
  const source = activeSourceFilter;
  mainEl.querySelectorAll(".section-block").forEach((sectionEl) => {
    const visible = applySectionSourceFilter(sectionEl, source);
    sectionEl.hidden = Boolean(source) && visible === 0;
  });
  const ul = document.getElementById("site-nav-sources");
  if (ul) {
    ul.querySelectorAll("button.site-nav-source").forEach((btn) => {
      const raw = btn.getAttribute("data-nav-source");
      const v = raw == null ? "" : raw;
      const on = v === source;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
}

function setupHeadlineExpanders(mainEl) {
  mainEl.querySelectorAll(".source-row-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      sourcePreviewModal.open({
        headline: btn.getAttribute("data-article-headline") || "Untitled",
        source: btn.getAttribute("data-article-source") || "Source",
        summary: btn.getAttribute("data-article-summary") || "No summary available in this feed.",
        url: btn.getAttribute("data-article-url") || "#",
      });
    });
  });
}

function renderRetailHighlights(retailItems) {
  const retail = retailItems || [];
  if (!retail.length) return "";
  return `
    <section class="retail-highlights section-block" id="section-retail" data-section="retail" aria-labelledby="retail-highlights-title">
      <div class="section-head section-head--retail">
        <div class="section-head-titles">
          <h2 id="retail-highlights-title">Retail</h2>
          <p class="section-sub">Storefronts, shopping, tenants & retail leasing only — no repeats below.</p>
        </div>
      </div>
      <div class="section-sources">
        <p class="section-sources-label">Headlines & highlights — click for preview, then read full article</p>
        <ul class="source-list" role="list">
          ${retail.map(renderHighlightRow).join("")}
        </ul>
      </div>
    </section>
  `;
}

function renderRead(digest) {
  const titleEl = document.getElementById("digest-title");
  const dateEl = document.getElementById("digest-date");
  const mainEl = document.getElementById("digest-main");

  titleEl.textContent = digest.title || "Ike's Morning Digest";
  dateEl.textContent = formatDate(digest.date);

  const items = digest.items || [];
  const grouped = groupBySource(items);
  let html = "";
  for (const { key, label, items: secItems } of grouped) {
    const displayItems = secItems;
    if (displayItems.length === 0) {
      continue;
    }
    const subText = "Stories from this outlet in today’s digest window.";
    html += `<section class="section-block" id="section-${key}" data-section="${escapeAttr(key)}">`;
    html += `
      <div class="section-head">
        <div class="section-head-titles">
          <h2>${escapeHtml(label)}</h2>
          <p class="section-sub">${escapeHtml(subText)}</p>
        </div>
      </div>
    `;
    html += `<div class="section-sources">`;
    html += `<p class="section-sources-label">Headlines & highlights — click for preview, then read full article</p>`;
    html += `<ul class="source-list" role="list">`;
    html += displayItems.map(renderHighlightRow).join("");
    html += `</ul>`;
    html += `</div>`;
    html += `</section>`;
  }

  if (items.length === 0) {
    html = `<p class="empty">No stories today. Add items in <code>data/digest.json</code> or run <code>npm run build:digest</code>.</p>`;
  }

  mainEl.innerHTML = html;
  setupHeadlineExpanders(mainEl);
  if (activeSourceFilter) {
    applyGlobalSourceFilter(mainEl, activeSourceFilter);
  }
}

function render(digest) {
  renderNavSources(digest);
  renderRead(digest);
}

function truncatePlain(text, max) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/** Full outlet / source label as one link to the story (e.g. “New York Post” all clickable). */
function outletSourceLinkHtml(sourceDisplay, url) {
  const src = String(sourceDisplay || "").trim();
  if (!src) return "";
  const href = url ? escapeAttr(String(url).trim()) : "";
  const label = escapeHtml(src);
  if (!href) return label;
  return `<a class="slide-outlet-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function nyHour24() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value;
  return h ? parseInt(h, 10) : 9;
}

function splashGreetingLine() {
  const h = nyHour24();
  if (h >= 5 && h < 12) return "Good morning, Ike";
  if (h >= 12 && h < 17) return "Good afternoon, Ike";
  return "Good evening, Ike";
}

/** One-time welcome overlay; dismisses on timer, Continue, Escape, or backdrop click. */
function initSplashScreen() {
  const splash = document.getElementById("splash");
  const greetingEl = document.getElementById("splash-greeting");
  const metaEl = document.getElementById("splash-meta");
  const dismissBtn = document.getElementById("splash-dismiss");
  if (!splash || !greetingEl) {
    return { showMeta() {}, dismiss() {} };
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  greetingEl.textContent = splashGreetingLine();

  let dismissed = false;
  let hideTimer = null;

  function hideSplash() {
    if (dismissed) return;
    dismissed = true;
    document.removeEventListener("keydown", onKey);
    if (hideTimer) clearTimeout(hideTimer);
    splash.classList.add("splash--out");
    splash.setAttribute("aria-hidden", "true");
    const removeMs = reduceMotion ? 120 : 620;
    setTimeout(() => {
      splash.remove();
      document.body.classList.remove("splash-active");
    }, removeMs);
  }

  document.body.classList.add("splash-active");

  dismissBtn?.addEventListener("click", () => hideSplash());
  splash.addEventListener("click", (e) => {
    if (e.target === splash) hideSplash();
  });
  const onKey = (e) => {
    if (e.key === "Escape") hideSplash();
  };
  document.addEventListener("keydown", onKey);

  const autoMs = reduceMotion ? 1400 : 3400;
  hideTimer = setTimeout(() => hideSplash(), autoMs);

  requestAnimationFrame(() => dismissBtn?.focus());

  return {
    showMeta(line) {
      if (!metaEl) return;
      if (!line) {
        metaEl.hidden = true;
        metaEl.textContent = "";
        return;
      }
      metaEl.textContent = line;
      metaEl.hidden = false;
    },
    dismiss() {
      hideSplash();
    },
  };
}

async function loadDigest() {
  const res = await fetch("data/digest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load digest");
  return res.json();
}

async function init() {
  const digest = await loadDigest();
  currentDigest = digest;
  splashCtl.showMeta(formatDate(digest.date));
  initNavSourcesNav();
  render(digest);
}

/** Replace with fetch("/api/chat", { body: JSON.stringify({ message, digest }) }) etc. */
async function fetchIkesAgentReply(_userMessage) {
  await new Promise((r) => setTimeout(r, 450));
  return "Ike's Agent isn't connected to your LLM yet. Add an API route that sends today's digest plus your question to the model. For now, use the hero summaries and source links on the left.";
}

function appendAskBubble(messagesEl, role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `ask-bubble ask-bubble--${role}${extraClass ? ` ${extraClass}` : ""}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function initAskPanel() {
  const fab = document.getElementById("ask-fab");
  const panel = document.getElementById("ask-panel");
  const backdrop = document.getElementById("ask-backdrop");
  const closeBtn = document.getElementById("ask-close");
  const form = document.getElementById("ask-form");
  const input = document.getElementById("ask-input");
  const sendBtn = document.getElementById("ask-send");
  const messagesEl = document.getElementById("ask-messages");
  if (!fab || !panel || !backdrop || !form || !input || !messagesEl) return;

  let openedOnce = false;
  let lastFocus = null;

  function openPanel() {
    lastFocus = document.activeElement;
    panel.classList.add("is-open");
    backdrop.classList.add("is-open");
    fab.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("ask-panel-open");

    if (!openedOnce) {
      appendAskBubble(
        messagesEl,
        "assistant",
        "I'm Ike's Agent. Ask about today's real estate digest. Wire up your API to get real answers."
      );
      openedOnce = true;
    }
    requestAnimationFrame(() => input.focus());
  }

  function closePanel() {
    panel.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    fab.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("ask-panel-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    else fab.focus();
  }

  fab.addEventListener("click", () => openPanel());
  closeBtn?.addEventListener("click", () => closePanel());
  backdrop.addEventListener("click", () => closePanel());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) {
      e.preventDefault();
      closePanel();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    appendAskBubble(messagesEl, "user", text);
    input.value = "";
    sendBtn.disabled = true;

    const pending = appendAskBubble(messagesEl, "assistant", "Thinking…", "ask-bubble--pending");

    try {
      const reply = await fetchIkesAgentReply(text);
      pending.textContent = reply;
      pending.classList.remove("ask-bubble--pending");
    } catch {
      pending.textContent = "Something went wrong. Try again after the API is set up.";
      pending.classList.remove("ask-bubble--pending");
    } finally {
      sendBtn.disabled = false;
      input.focus();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });
}

function initSourcePreviewModal() {
  const backdrop = document.getElementById("story-modal-backdrop");
  const modal = document.getElementById("story-modal");
  const closeBtn = document.getElementById("story-modal-close");
  const titleEl = document.getElementById("story-modal-title");
  const sourceEl = document.getElementById("story-modal-source");
  const summaryEl = document.getElementById("story-modal-summary");
  const linkEl = document.getElementById("story-modal-link");
  if (!backdrop || !modal || !titleEl || !sourceEl || !summaryEl || !linkEl) {
    return { open() {}, close() {} };
  }

  let lastFocus = null;

  function close() {
    modal.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("story-modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function open(payload) {
    lastFocus = document.activeElement;
    titleEl.textContent = payload.headline || "Untitled";
    sourceEl.textContent = payload.source || "Source";
    summaryEl.textContent = payload.summary || "No summary available in this feed.";
    const href = payload.url && payload.url !== "#" ? payload.url : "";
    if (href) {
      linkEl.href = href;
      linkEl.hidden = false;
    } else {
      linkEl.removeAttribute("href");
      linkEl.hidden = true;
    }
    modal.classList.add("is-open");
    backdrop.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("story-modal-open");
    requestAnimationFrame(() => closeBtn?.focus());
  }

  closeBtn?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      e.preventDefault();
      close();
    }
  });

  return { open, close };
}

const splashCtl = initSplashScreen();
const sourcePreviewModal = initSourcePreviewModal();

initAskPanel();

init().catch((err) => {
  splashCtl.dismiss();
  document.getElementById("digest-main").innerHTML = `
    <p class="empty"><strong>Could not load digest.</strong> Run a local server from this folder (see README) and open <code>http://localhost:8080</code>. ${escapeHtml(err.message)}</p>
  `;
});
