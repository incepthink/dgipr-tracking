# Live collection test: 15 Oct 2026 (Asia/Kolkata)

First live run against the real DGIPR accounts, collected on 16 Oct 2026 ~00:30 IST into the main DB
(`D:/dgipr-env/data/dgipr.sqlite3`; backup of the pre-run DB alongside it). Re-export any time with
`python scripts/collect.py --dump-only --date 2026-10-15`.

| Platform | Provider (actor/API) | Raw file | Items received | On 15 Oct IST | Campaign matches | Cost |
|---|---|---|---|---|---|---|
| Facebook | `apify~facebook-posts-scraper` | `raw/facebook_task22.json` (task21 = earlier run, same posts) | 60 (cap) | 48 (21 photo, 17 carousel, 10 reel) | 2 | ~$0.42/run, ran twice |
| Instagram | `apify~instagram-scraper` (posts + reels passes) | `raw/instagram_task19.json` | 86 → 74 unique | 37 (22 photo, 9 carousel, 6 reel) | 2 | ~$0.23 |
| X | `kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest` | `raw/x_task20.json` (+ `x_apify_kaito_probe.json`) | 158 → 79 unique (actor returns every tweet twice) | 45 (31 photo, 14 video) | 2 (+1 link-only tweet → insufficient_text) | ~$0.04 |
| YouTube | YouTube Data API v3 | `raw/youtube_task18.json` | 50 | 12 | 0 | 3 quota units |

Apify total for the month after this test: **$1.03 of $5**.

`publications.json` = normalised rows for 15 Oct with the classifier decision; `draft_2026-10-15.pdf` = draft report
(HQ row: Facebook 2, Instagram 2, X 2, YouTube 0; all other cells await manual entry).

## What the real responses look like (for making up test data)

* **Facebook**: `postId`, `url` (`/posts/pfbid…` or `/reel/<id>/`), `time` (ISO UTC), `timestamp` (unix), `text`,
  `likes`, `shares`, `topReactionsCount`, `viewsCount` (reels/videos only), `isVideo`, `media[]`. **No comment count** in the payload.
  Engagement right after posting is ~0 (e.g. a reel 30 min old: 58 views, 0 likes).
* **Instagram**: `shortCode`, `url`, `timestamp` (ISO UTC), `caption`, `hashtags[]`, `type` (`Image`/`Sidecar`/`Video`),
  `productType` (`feed`/`clips`), `likesCount`, `commentsCount`, `videoViewCount` (null for images). Typical likes are single digits to low tens.
* **X**: TwitterAPI.io tweet objects: `id`, `url`, `createdAt` (`Thu Oct 15 18:30:30 +0000 2026`), `text`, `lang` (mostly `mr`),
  `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `viewCount`, `bookmarkCount`, `isPinned`, `extendedEntities.media[]`.
  Views are in the hundreds; likes and retweets are often 0. Text is often truncated with `…` plus a `t.co` link.
* **YouTube**: `{playlistItem, video}` pairs; `video.statistics` values are **strings** (`"viewCount": "0"`),
  `contentDetails.duration` is ISO 8601 (`PT5M1S`). There's no Shorts flag.
* The same announcement goes out on FB, IG and X with identical Marathi text, so a campaign post usually counts once per platform.
