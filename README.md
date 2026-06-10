# Ike's Morning Digest

Local morning digest: **hero summary** per topic, then compact **source links**. Use the header (**Read** / **Audio** / **Slides**) to scan the same JSON as an article list, spoken brief, or slide deck.

## Run locally

Browsers block loading `data/digest.json` from a `file://` URL. Serve the folder:

```bash
cd "/Users/abrahama/Downloads/Ike Chera News "
python3 -m http.server 8080
```

Open [http://localhost:8080/#section-markets](http://localhost:8080/#section-markets).

## Refresh the digest from public RSS (v1)

This pulls **headlines, links, and teaser text** from each publisher’s RSS feed (no paywalled article bodies). Install once, then run whenever you want a fresh snapshot:

```bash
cd "/Users/abrahama/Downloads/Ike Chera News "
npm install
npm run build:digest
```

After editing `items` by hand, you can rebuild only the **At a glance** (`section_overviews`) paragraphs from the existing teasers with:

```bash
npm run refresh:overviews
```

Sources wired today: **Commercial Observer** — **Retail hub parity** (unchanged): category RSS plus a filtered main-site supplement; see `scripts/build-digest.mjs`. **The Real Deal** — New York feed plus `https://therealdeal.com/tag/retail/feed/` restricted to NYC/tri-state by URL/title. **PincusCo** — main feed only (their WordPress `category/retail` RSS is abandoned / years stale). **Crain’s** — FeedBurner latest news with a CRE title filter. **New York Post** — `nypost.com/real-estate/feed/` plus the same NYC-skewing title filter as before. **CRE Daily** — [Retail sector](https://www.credaily.com/sectors/retail/) via `https://www.credaily.com/sectors/retail/feed/` (briefs + sector stories in RSS). For all of these except Commercial Observer’s own pair, the builder uses **`SECTION_DIGEST_ROLLING_HOURS` (336h)** and, where noted in the feed list, **`skipHardRealEstateEventFilter`** so short RSS teasers do not drop stories that the site still shows. Do **not** use `https://commercialobserver.com/retail/feed/` for CO articles — wrong WordPress endpoint.

Then refresh the browser. The digest `date` is **today in America/New_York**; see `data_note` and `coverage_window_hours` in the JSON for how recency is defined.

## Edit the digest by hand

You can still edit `data/digest.json` after a build, or maintain it entirely manually:

Edit `data/digest.json`:

- `date` — ISO date `YYYY-MM-DD` (shown in the header).
- `section_overviews` *(optional)* — **At a glance** teaser copy per **outlet**. Keys are stable slugs from `source` (same as `item.section`, e.g. `commercial_observer`, `cre_daily`, `pincusco`, `the_real_deal`). On `npm run build:digest`, each outlet gets short paragraphs from that outlet’s RSS teasers. Regenerate from existing `items` only with `npm run refresh:overviews`.
- `items` — array of stories. Each item:
  - `headline` — required.
  - `summary` — 2–4 lines (RSS build uses each publisher’s teaser when available).
  - `source` — e.g. `The Real Deal`, `WSJ`, `Bloomberg`.
  - `url` — link to the article (Ike uses his subscriptions when opening).
  - `section` — stable slug from the outlet name (matches a key in `section_overviews`); the **Read** view groups stories by outlet using this field together with `source`.
  - `retail` — optional `true` if retail-specific (still set by the RSS build for your own sorting or future use; the UI no longer shows a badge).
  - `published_at` — optional ISO timestamp (added by `npm run build:digest`); safe to leave for provenance or delete.

Refresh the page after saving.

## Manual-only workflow (optional)

If you prefer not to use RSS: pick pieces from his outlets, then add **headline, URL, and summary** to `items`. Write **section_overviews** (one key per outlet slug) to tie each outlet block together. Per-article `summary` is shown on **hover** over each headline so the page stays short.

**Paywalls:** Auto-fetch uses **RSS metadata only**, not full article text behind WSJ etc. Links open in the browser where his subscriptions apply.

## Ike's Agent (sidebar)

The **chat** button (bottom-right) opens **Ike's Agent**. It’s UI-ready; replies are a placeholder until you add an API (e.g. `POST /api/chat` with the user message plus a string snapshot of `digest.json`). Replace `fetchIkesAgentReply` in `app.js` with that call.

## Next steps (optional)

- LLM: backend route + inject today’s digest text into the model context.
- Email: same JSON → small Python script + cron.
- Audio: in-browser speech uses a slower, calmer voice when available, and a story-by-story script (not the full “at a glance” block).
- Slides: generate from the same JSON.
