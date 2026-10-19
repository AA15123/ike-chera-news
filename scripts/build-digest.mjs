/**
 * Builds data/digest.json from publisher RSS feeds (public metadata only).
 * Headlines, links, and blurbs come from each feed's title/description — no paywalled body scraping.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { buildOverviews, sourceSectionSlug } from "./section-overviews.mjs";
import { stripEmojis } from "./strip-emojis.mjs";
import { stripFilingNumberNoise } from "./strip-filing-noise.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "digest.json");

const TZ = "America/New_York";

/** Default RSS recency window (hours); each feed can set `rollingHours`. */
const ROLLING_HOURS = 40;

/**
 * Section-style lookback for non–Commercial Observer sources so digest rows match what is still
 * visible on publisher listing pages when `pubDate` is older than {@link ROLLING_HOURS}.
 */
const SECTION_DIGEST_ROLLING_HOURS = 336;

/**
 * RSS feeds (public metadata only). WSJ real estate is the Dow Jones feed at
 * `feeds.content.dowjones.io` (older `feeds.a.dj.com` URLs stopped updating).
 * Traded blocks anonymous RSS, so that outlet is read from its public news listing.
 */
const FEEDS = [
  /**
   * Industry → Retail vertical only (same article pool as https://commercialobserver.com/retail/ ).
   * WordPress category feed: `/category/retail/feed/`. Do NOT use `https://commercialobserver.com/retail/feed/`
   * — that URL is WP’s “comments” RSS for the page, not posts (empty / wrong).
   */
  {
    id: "co",
    source: "Commercial Observer",
    url: "https://commercialobserver.com/category/retail/feed/",
    sectionDefault: "real_estate",
    max: 22,
    /** Retail hub surfaces leases for ~two weeks; category RSS pubDates trail the hero grid. */
    rollingHours: 336,
    /** Category is already Retail; do not require “lease/$/SF” in the RSS teaser. */
    skipHardRealEstateEventFilter: true,
    /** Was two CO feeds (main + retail); keep a bit more headroom for retail-only. */
    realEstateFeedCap: 12,
  },
  /**
   * Picks national retail / REIT lines from the main feed that the Retail hub surfaces but WordPress
   * does not always file under the Retail category (deduped against `co` by URL).
   */
  {
    id: "co-hub",
    source: "Commercial Observer",
    url: "https://commercialobserver.com/feed/",
    sectionDefault: "real_estate",
    max: 18,
    rollingHours: 72,
    filterTitle: coRetailHubMainFeedFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 6,
  },
  {
    id: "trd",
    source: "The Real Deal",
    url: "https://therealdeal.com/new-york/feed/",
    sectionDefault: "real_estate",
    max: 18,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 10,
  },
  {
    id: "trd-retail",
    source: "The Real Deal",
    url: "https://therealdeal.com/tag/retail/feed/",
    sectionDefault: "real_estate",
    max: 22,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: trdRetailTagNyMetroFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 6,
  },
  {
    id: "pincus",
    source: "PincusCo",
    url: "https://www.pincusco.com/feed/",
    sectionDefault: "real_estate",
    max: 14,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 8,
  },
  {
    id: "crains",
    source: "Crain's New York",
    url: "https://feeds.feedburner.com/crainsnewyork/latestnews?format=xml",
    sectionDefault: "real_estate",
    max: 12,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: realEstateOnlyFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 6,
  },
  {
    id: "nypost-re",
    source: "New York Post",
    url: "https://nypost.com/real-estate/feed/",
    sectionDefault: "real_estate",
    max: 14,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: nypostRealEstateFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 8,
  },
  {
    id: "credaily-retail",
    source: "CRE Daily",
    /** Same article pool as https://www.credaily.com/sectors/retail/ (WordPress sector RSS). */
    url: "https://www.credaily.com/sectors/retail/feed/",
    sectionDefault: "real_estate",
    max: 14,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 6,
  },
  {
    id: "wsj-re",
    source: "The Wall Street Journal",
    /** Official Real Estate section. Lifestyle, opinion, and rate tables are filtered out. */
    url: "https://feeds.content.dowjones.io/public/rss/latestnewsrealestate",
    sectionDefault: "real_estate",
    max: 16,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: wsjRealEstateFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 4,
    guarantee: 4,
  },
  {
    id: "nyt-re",
    source: "The New York Times",
    /** Real Estate section front. House tours and listing roundups are filtered out. */
    url: "https://rss.nytimes.com/services/xml/rss/nyt/RealEstate.xml",
    sectionDefault: "real_estate",
    max: 16,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: nytRealEstateFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 4,
    guarantee: 3,
  },
  {
    id: "nyt-biz",
    source: "The New York Times",
    /** Business front, kept only when the headline is actually about property. */
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    sectionDefault: "real_estate",
    max: 12,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: nytRealEstateFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 3,
    guarantee: 2,
  },
  {
    id: "traded",
    source: "Traded",
    /** Public news listing. Direct RSS is Cloudflare-blocked; see `fetchTradedItems`. */
    url: "https://traded.co/news/",
    kind: "traded-news",
    sectionDefault: "real_estate",
    max: 12,
    rollingHours: SECTION_DIGEST_ROLLING_HOURS,
    filterTitle: tradedDealFilter,
    skipHardRealEstateEventFilter: true,
    realEstateFeedCap: 5,
    guarantee: 4,
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name, jpath) => name === "item",
});

function nypostRealEstateFilter(title, _link = "") {
  const t = String(title || "");
  const skip =
    /\b(celebrity|divorce|wedding|‘|Shahs|Sunset|Netflix|HGTV|Inside\s|tour\s+of\s+her|reveals\s+how)\b/i.test(t);
  if (skip) return false;
  // Post “real estate” mixes national celebrity property tabloid; Ike’s digest is NYC CRE–leaning.
  if (
    /\b(Beverly Hills|Malibu|Surfside|LA County|Miami|Los Angeles|Bruce Willis|Kardashian)\b/i.test(t)
  ) {
    return /\b(NYC|New York City|Manhattan|Brooklyn|Queens|Bronx|Staten Island|Hudson|Midtown|UES|UWS)\b/i.test(
      t
    );
  }
  return true;
}

/** TRD global retail tag feed: keep tri-state / NYC lines (URL or headline), drop e.g. Miami-only lease roundups. */
function trdRetailTagNyMetroFilter(title, link = "") {
  const u = String(link || "");
  const t = String(title || "");
  if (/\/new-york\//i.test(u)) return true;
  if (
    /\b(NYC|New York City|Manhattan|Brooklyn|Queens|Bronx|Staten Island|Long Island|Westchester|White Plains|Scarsdale|Yonkers|Jersey City|Newark|Hoboken|Greenwich|Stamford|Connecticut)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function realEstateOnlyFilter(title, _link = "") {
  const t = String(title || "");
  const hasRealEstateSignal =
    /\b(real estate|commercial real estate|cre|property|properties|building|development|developer|lease|leasing|tenant|landlord|office|retail|storefront|mall|shopping center|mixed-use|multifamily|apartment|rental|condo|condominium|brokerage|mortgage|refinance|loan|cmbs|construction|permit|rezoning|vacancy|rent)\b/i.test(
      t
    );
  const obviousOffTopic =
    /\b(election|campaign|vote|senate|congress|war|military|crypto|ai model|iphone|apple|google|xai|pope|fitness test|california governor)\b/i.test(
      t
    );
  return hasRealEstateSignal && !obviousOffTopic;
}

/** WSJ Real Estate section mixes housing markets with house tours, opinion, and rate tables. */
function wsjRealEstateFilter(title, _link = "") {
  const t = String(title || "");
  if (/^\s*opinion\b/i.test(t)) return false;
  if (
    /\b(house of the week|historic homes|current mortgage rates|current home equity|should i refinance|custom furniture|how to build a custom|gave their family a fresh start|oscars and emmy)\b/i.test(
      t
    )
  ) {
    return false;
  }
  return (
    realEstateOnlyFilter(t) ||
    /\b(housing|home prices|home sales|mortgage|condo|condominium|listings|pied-à-terre|pied-a-terre|airbnb|senior housing|senior-housing|commercial real-estate|commercial real estate|real-estate deals|real estate deals)\b/i.test(
      t
    )
  );
}

/** NYT Real Estate is mostly residential features. Keep market, deal, and landlord stories. */
function nytRealEstateFilter(title, _link = "") {
  const t = String(title || "");
  if (
    /\b(homes for sale|which (?:\$[\d,]+ )?home would you choose|house hunting|what i love|living near the|art scene called|barely breaks even|prefab housing|downsize|wood floor|townhouse where|family compound|roommate|renting in|what now|what can i do|my building says|i need |i'm looking)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (isLifestyleOrCelebrityNoise(t, "")) return false;
  return (
    realEstateOnlyFilter(t) ||
    /\b(housing|rent(?:ing|al)?|landlord|co-op|coop|condo|mortgage|home prices|apartment building|tenants?)\b/i.test(
      t
    )
  );
}

/** Traded's news listing is commercial deals. Drop venture-capital raises that are not property. */
function tradedDealFilter(title, _link = "") {
  const t = String(title || "");
  const property =
    /\b(sold|sale|lease|leased|loan|refi|refinance|construction|development|apartment|multifamily|office|retail|industrial|mixed-use|square feet|units|tower|building|property|renovation)\b/i.test(
      t
    );
  const ventureRaise = /\braises?\s+\$?\d/i.test(t);
  if (ventureRaise && !property) return false;
  return property;
}

function nyDateParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function nyTodayMeta() {
  return { isoDate: nyDateParts() };
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUMMARY_MAX_CHARS = 520;
const REAL_ESTATE_LIMIT = 30;
const REAL_ESTATE_FEED_CAP = 8;

function smartTruncate(text, max = SUMMARY_MAX_CHARS) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentenceCut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceCut >= Math.floor(max * 0.55)) {
    return `${window.slice(0, sentenceCut + 1).trim()}…`;
  }
  const wordCut = window.lastIndexOf(" ");
  if (wordCut >= Math.floor(max * 0.7)) {
    return `${window.slice(0, wordCut).trim()}…`;
  }
  return `${window.trim()}…`;
}

function retailSignalScore(title, summary) {
  const blob = `${title}\n${summary}`;
  let score = 0;
  if (/\b(retail|storefront|shopping|mall|strip center|shopping center)\b/i.test(blob)) score += 2;
  if (/\b(tenant|anchor tenant|lease|leased|sf|square feet|asking rent|rent psf)\b/i.test(blob)) score += 2;
  if (/\b(restaurant|qsr|food hall|grocery|big box|flagship|foot traffic|ground[\s-]?floor|retailer|pop-?up)\b/i.test(blob))
    score += 1;
  return score;
}

function isRetail(title, summary) {
  return retailSignalScore(title, summary) > 0;
}

/**
 * Main-site RSS only: stories that often appear on the [Retail hub](https://commercialobserver.com/retail/)
 * but are not in `category/retail` (e.g. REIT earnings). Excludes generic office / macro / Power list noise.
 */
function coRetailHubMainFeedFilter(title, _link = "") {
  const t = String(title || "");
  if (
    /\bMultifamily Construction Starts\b|\bPower 100\b|\bcommencement address\b|\bHollywood\b.*\bStudio\b|\boffice vacancy is\b|\bst\. john'?s reaches deal\b|\bpols and lobbyists\b|\bBig Names in Commercial Real Estate Died\b|\bdata centers sparked\b|\bin dallas-fort worth\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (/\bOffice Lease\b/i.test(t)) return false;
  if (/\$\s*\d/.test(t) && /\b(Simon Property|Macerich|Taubman|Kimco|Brixmor|Federal Realty|Regency)\b/i.test(t))
    return true;
  if (retailSignalScore(t, t) > 0) return true;
  if (/\b(shopping center|outlet mall|street retail|grocery-anchored|retail REIT|mall giant)\b/i.test(t)) return true;
  return false;
}

function isLowSignalRealEstate(title, summary) {
  const blob = `${title}\n${summary}`;
  return /\b(he wrote the book|wanting to be the first in his family|young [A-Z][a-z]+|sign up to get early access|this story gives you a peek|in this edition we mention|clashes with|forum|panel discussion|op-ed|interview with|q&a)\b/i.test(
    blob
  );
}

function isLifestyleOrCelebrityNoise(title, summary) {
  const blob = `${title}\n${summary}`;
  return /\b(celebrity|actor|actress|tv star|reality star|netflix|hgtv|dawson'?s creek|estranged wife|divorce|mansion|home tour|dream home|inside .* home|beverly hills|malibu|cape cod)\b/i.test(
    blob
  );
}

function realEstateSignalScore(title, summary) {
  const blob = `${title}\n${summary}`;
  let score = 0;
  if (/\b(sold|sale|acquired|acquisition|portfolio|transaction|loan|financing|refinance|recapitalization)\b/i.test(blob))
    score += 2;
  if (/\b(development|project|tower|units|permit|rezoning|construction|mixed-use|hotel|office)\b/i.test(blob)) score += 2;
  if (/\b(new york|nyc|manhattan|brooklyn|queens|bronx|staten island)\b/i.test(blob)) score += 1;
  score += retailSignalScore(title, summary);
  return score;
}

/**
 * Real estate section should be action-oriented (deal, lease, financing, development),
 * not commentary that only references RE names or firms.
 */
function hasHardRealEstateEvent(title, summary) {
  const blob = `${title}\n${summary}`;
  const hasStrongActionSignal =
    /\b(lease|leased|tenant|occup(y|ied)|square feet|\bsf\b|rent(?:ed|al)?|asking rent)\b/i.test(blob) ||
    /\b(sold|sale|acquir(?:e|ed)|acquisition|portfolio|transaction|closed|buy(?:out)?|disposed)\b/i.test(blob) ||
    /\b(loan|financ(?:e|ing)|refinanc(?:e|ing)|debt|cmbs|mortgage|bridge loan|construction loan)\b/i.test(blob) ||
    /\b(filed plans?|permit|rezon(?:e|ing)|ground lease|units?|tower|mixed-use)\b/i.test(blob);

  const hasConcreteDealDetail =
    /\$\d|\b\d[\d,]{2,}\s*(?:square feet|sf|units?)\b/i.test(blob) ||
    /\b(?:at|for)\s+\d{1,4}\s+[A-Z0-9][A-Za-z0-9.' -]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/.test(blob);

  const looksLikeCommentaryWithoutEvent =
    /\b(calls?|slams?|criticiz(?:e|es|ed)|video|spat|feud|campaign|mayor|governor|council|politic)\b/i.test(blob) &&
    !hasConcreteDealDetail;

  return hasStrongActionSignal && !looksLikeCommentaryWithoutEvent;
}

function normalizeItems(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function fetchText(url) {
  const attempts = [
    {
      "User-Agent": "IkeMorningDigest/1.0 (+https://example.local; contact: internal)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  ];
  let lastStatus = 0;
  for (const headers of attempts) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status !== 403 && res.status !== 401) break;
  }
  throw new Error(`${url} → ${lastStatus}`);
}

const TRADED_MONTH =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function cleanTradedTitle(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  const dateRe = new RegExp(`\\b(?:${TRADED_MONTH})[a-z]*\\s+\\d{1,2},\\s+\\d{4}\\b`, "i");
  if (/traded media/i.test(t) || dateRe.test(t)) {
    t = t.split(dateRe)[0].trim();
  }
  t = t.replace(/traded media/gi, "").trim();
  for (let i = 0; i < 2; i += 1) {
    const next = t.replace(
      /^(?:Office|Retail|Industrial|Multifamily|Residential|Development Site|New York|Texas|Florida|California|Chicago|National|Loan|Lease)\s+/i,
      ""
    );
    if (next === t) break;
    t = next.trim();
  }
  return t;
}

function tradedDateIn(text) {
  const match = String(text || "").match(
    new RegExp(`\\b(?:${TRADED_MONTH})[a-z]*\\s+\\d{1,2},\\s+\\d{4}\\b`, "i")
  );
  if (!match) return null;
  const pub = new Date(match[0]);
  return Number.isNaN(pub.getTime()) ? null : pub;
}

/** Traded news page, as markdown from the reader proxy or as HTML if the site allows it. */
function parseTradedListing(text) {
  const src = String(text || "");
  const byUrl = new Map();
  const remember = (url, label, index) => {
    const cleanUrl = String(url || "").split("?")[0].replace(/\/+$/, "/");
    if (!/\/blog\//i.test(cleanUrl)) return;
    if (!byUrl.has(cleanUrl)) byUrl.set(cleanUrl, { labels: [], pub: null });
    const row = byUrl.get(cleanUrl);
    const textLabel = String(label || "").replace(/\s+/g, " ").trim();
    if (textLabel) row.labels.push(textLabel);
    if (!row.pub) {
      row.pub = tradedDateIn(textLabel) || tradedDateIn(src.slice(Math.max(0, index - 240), index + 40));
    }
  };

  const linkRe = /\[([^\]]*)\]\((https?:\/\/traded\.co\/blog\/[^)\s]+)\)/gi;
  let match;
  while ((match = linkRe.exec(src))) remember(match[2], match[1], match.index);
  const hrefRe = /href="(https?:\/\/traded\.co\/blog\/[^"]+)"[^>]*>([^<]{12,240})</gi;
  while ((match = hrefRe.exec(src))) remember(match[1], stripHtml(match[2]), match.index);

  const articles = [];
  for (const [url, row] of byUrl) {
    const texts = [...new Set(row.labels.filter(Boolean))];
    const titled = texts
      .map(cleanTradedTitle)
      .filter((label) => label.length >= 25 && label.length <= 180 && !/traded media/i.test(label));
    const title = titled.sort((a, b) => a.length - b.length)[0] || "";
    if (title.length < 25 || !row.pub) continue;
    const summary =
      texts
        .filter((label) => !/traded media/i.test(label) && label !== title && label.length > 40)
        .sort((a, b) => b.length - a.length)[0] || "";
    articles.push({ title, link: url, pub: row.pub, summary: summary.startsWith(title) ? "" : summary });
  }
  return articles;
}

async function fetchTradedItems() {
  const pageUrl = "https://traded.co/news/";
  let listing = "";
  try {
    const direct = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html",
      },
    });
    if (direct.ok) listing = await direct.text();
  } catch {
    listing = "";
  }
  if (!/traded\.co\/blog\//i.test(listing)) {
    const proxied = await fetch("https://r.jina.ai/https://traded.co/news/", {
      headers: {
        Accept: "text/plain",
        "User-Agent": "IkeMorningDigest/1.0",
      },
    });
    if (!proxied.ok) throw new Error(`Traded news listing → ${proxied.status}`);
    listing = await proxied.text();
  }
  return parseTradedListing(listing);
}

function parseRss(xml) {
  const doc = parser.parse(xml);
  const channel = doc.rss?.channel || doc.feed;
  if (!channel) return { title: "", items: [] };
  const items = normalizeItems(channel.item);
  return { title: channel.title, items };
}

function normalizeLink(link) {
  if (!link) return "";
  if (typeof link === "string") return link.trim();
  if (typeof link === "object") {
    const href = link["@_href"] || link.href;
    const text = link["#text"];
    return String(href || text || "").trim();
  }
  return String(link).trim();
}

function itemPubDate(item) {
  const raw =
    item.pubDate ||
    item["dc:date"] ||
    item["dcterms:modified"] ||
    item.updated ||
    item.published;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function decodeBasicEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201c")
    .replace(/&#8221;/g, "\u201d")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function pickSummary(item) {
  const enc = item["content:encoded"] || item.content || item.description || "";
  const plain = stripFilingNumberNoise(stripEmojis(stripHtml(enc)));
  if (plain.length > 40) return smartTruncate(plain, SUMMARY_MAX_CHARS);
  return "";
}

function dedupeKey(item) {
  try {
    const u = new URL(item.url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return item.url;
  }
}

async function collect() {
  const { isoDate } = nyTodayMeta();
  const collected = [];

  for (const feed of FEEDS) {
    let dated;
    if (feed.kind === "traded-news") {
      try {
        const articles = await fetchTradedItems();
        dated = articles.map((it) => ({ ...it, feed })).filter((it) => it.link && it.title);
      } catch (e) {
        console.warn(`Skip ${feed.source} (${feed.url}): ${e.message}`);
        continue;
      }
    } else {
      let xml;
      try {
        xml = await fetchText(feed.url);
      } catch (e) {
        console.warn(`Skip ${feed.source} (${feed.url}): ${e.message}`);
        continue;
      }
      const { items } = parseRss(xml);
      dated = items
        .map((it) => {
          const rawTitle = it.title;
          const title = stripEmojis(
            stripHtml(
              typeof rawTitle === "object" ? rawTitle["#text"] || "" : rawTitle || it["#text"] || ""
            ).replace(/^<!\[CDATA\[|\]\]>$/g, "")
          ) || "Untitled";
          const link = normalizeLink(it.link);
          const pub = itemPubDate(it);
          return { title, link, pub, summary: pickSummary(it), feed };
        })
        .filter((it) => it.link && it.title);
    }

    const hours = feed.rollingHours ?? ROLLING_HOURS;
    const windowMs = hours * 60 * 60 * 1000;
    const filtered = dated.filter((it) => {
      if (feed.filterTitle && !feed.filterTitle(it.title, it.link)) return false;
      if (!it.pub) return false;
      return Date.now() - it.pub.getTime() <= windowMs;
    });

    const pool = filtered.length ? filtered : [];

    if (!pool.length) {
      console.warn(`No items in last ${hours}h for ${feed.source} (${feed.id})`);
      continue;
    }

    pool.sort((a, b) => b.pub - a.pub);
    for (const it of pool.slice(0, feed.max)) {
      collected.push(it);
    }
  }

  // De-dupe by URL path
  const seen = new Set();
  const unique = [];
  for (const it of collected) {
    const k = dedupeKey({ url: it.link });
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }

  function toDigestRow(it) {
    const displaySource = it.feed.source;
    const section = sourceSectionSlug(displaySource);
    const summary =
      it.summary ||
      "Publisher teaser not in the feed — open the link for the full piece (subscriptions may apply).";
    return {
      headline: stripEmojis(decodeBasicEntities(it.title)),
      summary: stripFilingNumberNoise(
        stripEmojis(decodeBasicEntities(smartTruncate(stripFilingNumberNoise(summary), SUMMARY_MAX_CHARS)))
      ),
      source: displaySource,
      url: it.link,
      section,
      retail: isRetail(it.title, it.summary),
      published_at: it.pub.toISOString(),
    };
  }

  function pickTopWithFeedCap(items, limit, defaultPerFeedCap) {
    const out = [];
    const counts = new Map();
    for (const it of items) {
      if (out.length >= limit) break;
      const cap = it.feed.realEstateFeedCap ?? defaultPerFeedCap;
      const nextCount = (counts.get(it.feed.id) || 0) + 1;
      if (nextCount > cap) continue;
      counts.set(it.feed.id, nextCount);
      out.push(it);
    }
    return out;
  }

  /** New outlets get a few stories even when retail-heavy feeds fill the main cap. */
  function ensureFeedMinimum(picked, candidates, hardLimit) {
    const out = [...picked];
    const seen = new Set(out.map((it) => it.link));
    const counts = new Map();
    for (const it of out) counts.set(it.feed.id, (counts.get(it.feed.id) || 0) + 1);
    for (const it of candidates) {
      const min = it.feed.guarantee;
      if (!min || out.length >= hardLimit) continue;
      if (seen.has(it.link)) continue;
      const have = counts.get(it.feed.id) || 0;
      if (have >= min) continue;
      out.push(it);
      seen.add(it.link);
      counts.set(it.feed.id, have + 1);
    }
    return out;
  }

  const reCandidates = unique
    .filter((u) => u.feed.sectionDefault === "real_estate")
    .filter((u) => !isLifestyleOrCelebrityNoise(u.title, u.summary))
    .filter((u) => !isLowSignalRealEstate(u.title, u.summary))
    .filter((u) => u.feed.skipHardRealEstateEventFilter || hasHardRealEstateEvent(u.title, u.summary))
    .map((u) => ({
      ...u,
      retailScore: retailSignalScore(u.title, u.summary),
      reScore: realEstateSignalScore(u.title, u.summary),
    }))
    .filter((u) => u.feed.skipHardRealEstateEventFilter || u.reScore > 0)
    .sort((a, b) => b.retailScore - a.retailScore || b.reScore - a.reScore || b.pub - a.pub);
  const rePicked = ensureFeedMinimum(
    pickTopWithFeedCap(reCandidates, REAL_ESTATE_LIMIT, REAL_ESTATE_FEED_CAP),
    reCandidates,
    48
  );

  const capped = rePicked.map(toDigestRow);

  return { isoDate, items: capped };
}

const { isoDate, items } = await collect();
const digest = {
  title: "Ike's Morning Digest",
  date: isoDate,
  generated_at: new Date().toISOString(),
  coverage_window_hours: ROLLING_HOURS,
  data_note:
    "Built from publisher RSS metadata (titles + teaser text). `coverage_window_hours` is the default (40h); several feeds use a longer `rollingHours` (see `scripts/build-digest.mjs`) so rows align with what is still on each publisher’s listing pages. Commercial Observer keeps its retail category + hub supplement; TRD adds a New York–filtered global retail tag feed. PincusCo uses the live site feed only (`/category/retail/feed/` is stale). **CRE Daily** retail briefs come from `credaily.com/sectors/retail/feed/`. **WSJ** is the Dow Jones real-estate feed with lifestyle and opinion dropped. **The New York Times** keeps real-estate and property stories only. **Traded** is commercial deal briefs from its news listing. Open each link for the full article (subscriptions may apply in the browser).",
  section_overviews: buildOverviews(items),
  items,
};

writeFileSync(OUT, JSON.stringify(digest, null, 2) + "\n", "utf8");
console.log(`Wrote ${OUT} (${items.length} items) for ${isoDate}`);
