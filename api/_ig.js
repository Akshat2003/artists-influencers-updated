// Instagram Graph API "business_discovery" fetch + metric computation +
// artist/influencer category inference.
//
// This is a JS port of d:\Underdawg\ig_discovery.py — the engagement-rate
// formula is kept byte-for-byte identical (see computeMetrics).
//
// Reads server-only env: IG_USER_ID, IG_TOKEN, IG_API_VERSION (optional).
// Uses Node 18+ global fetch (Vercel provides it; no extra dependency).

export const IG_API_VERSION = process.env.IG_API_VERSION || 'v21.0';
export const RECENT_POST_COUNT = 12;
const GRAPH = 'https://graph.facebook.com';
const FETCH_TIMEOUT_MS = 15000; // stay under Vercel's function timeout

// ---- follower tiers -------------------------------------------------------
export function tierFor(followers) {
  if (followers == null || !Number.isFinite(followers)) return null;
  if (followers < 15000) return 'nano';
  if (followers < 100000) return 'micro';
  if (followers < 1000000) return 'mid';
  return 'mega';
}

// ---- fields string --------------------------------------------------------
export function buildFields(username) {
  const u = String(username).trim().replace(/^@+/, '');
  return (
    `business_discovery.username(${u})` +
    `{id,ig_id,username,name,biography,website,followers_count,follows_count,` +
    `media_count,profile_picture_url,` +
    `media.limit(${RECENT_POST_COUNT})` +
    `{id,like_count,comments_count,media_type,media_product_type,timestamp,caption,permalink}}`
  );
}

// ---- Graph fetch ----------------------------------------------------------
// Returns a normalized object; NEVER throws on API-level errors:
//   { status: 'ok',            raw }
//   { status: 'undiscoverable', error }   (private / personal / not found)
//   { status: 'pending',        error }   (rate limited, or IG not configured)
//   { status: 'error',          error }   (auth, http 5xx, network, bad json)
export async function fetchBusinessDiscovery(username) {
  const igUserId = process.env.IG_USER_ID;
  const token = process.env.IG_TOKEN;
  if (!igUserId || !token) {
    return { status: 'pending', error: 'ig_not_configured' };
  }

  const params = new URLSearchParams({
    fields: buildFields(username),
    access_token: token,
  });
  const url = `${GRAPH}/${IG_API_VERSION}/${igUserId}?${params.toString()}`;

  // Small retry loop: transient 5xx only. Rate limits return immediately as
  // 'pending' (the hourly window won't clear within a request).
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) return { status: 'error', error: 'network' };
      await sleep(500 * (attempt + 1));
      continue;
    }
    clearTimeout(timer);

    let body;
    try {
      body = await res.json();
    } catch {
      return { status: 'error', error: 'badjson' };
    }

    if (res.ok && body && body.business_discovery) {
      const bd = body.business_discovery;
      const media = (bd.media && Array.isArray(bd.media.data)) ? bd.media.data : [];
      if (!bd.followers_count) {
        return { status: 'undiscoverable', error: 'no_followers' };
      }
      const raw = {
        id: bd.id ?? null,
        ig_id: bd.ig_id ?? null,
        username: bd.username ?? String(username).replace(/^@+/, ''),
        name: bd.name ?? null,
        biography: bd.biography ?? null,
        website: bd.website ?? null,
        followers_count: bd.followers_count ?? null,
        follows_count: bd.follows_count ?? null,
        media_count: bd.media_count ?? null,
        profile_picture_url: bd.profile_picture_url ?? null,
        fetchedPostCount: media.length,
        media: media.map((m) => ({
          id: m.id ?? null,
          like_count: m.like_count ?? null,
          comments_count: m.comments_count ?? null,
          media_type: m.media_type ?? null,
          media_product_type: m.media_product_type ?? null,
          timestamp: m.timestamp ?? null,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
        })),
      };
      return { status: 'ok', raw };
    }

    const err = (body && body.error) || {};
    const code = err.code;

    // app/user rate limit -> save as pending, enrich later
    if ([4, 17, 32, 613].includes(code) || res.status === 429) {
      return { status: 'pending', error: 'rate_limited' };
    }
    // transient server error -> short backoff + retry
    if ([500, 502, 503, 504].includes(res.status)) {
      if (attempt === 2) return { status: 'error', error: `http_${res.status}` };
      await sleep(1000 * (attempt + 1));
      continue;
    }
    // target not a discoverable business/creator account, or not found
    if ([100, 110, 24].includes(code) || res.status === 400) {
      return { status: 'undiscoverable', error: `undiscoverable:${code ?? res.status}` };
    }
    // auth / permission / token problem -> needs operator action
    if ([190, 10, 200, 803].includes(code)) {
      return { status: 'error', error: `auth_error:${code}` };
    }
    return { status: 'error', error: `http_${res.status}` };
  }
  return { status: 'pending', error: 'rate_limited' };
}

// ---- metric computation ---------------------------------------------------
export function computeMetrics(raw) {
  const F = Number(raw.followers_count) || 0;
  const follows = Number(raw.follows_count) || 0;
  const posts = Array.isArray(raw.media) ? raw.media : [];
  const N = posts.length;

  const tier = tierFor(F);
  const followerFollowingRatio = follows > 0 ? round(F / follows, 2) : null;

  if (N === 0) {
    return {
      engagementRateMean: null,
      engagementRateMedian: null,
      avgLikes: null,
      avgComments: null,
      commentToLikeRatio: null,
      engagementStdev: null,
      engagementCV: null,
      topPostToMedianRatio: null,
      viralReachFlag: false,
      followerFollowingRatio,
      followerTier: tier,
      contentMix: null,
      reelAvgEngagement: null,
      feedAvgEngagement: null,
      postsPerWeek: null,
      daysSinceLastPost: null,
      postingCadence: null,
      postSpanDays: null,
      avgCaptionLength: 0,
      avgHashtagCount: 0,
      avgMentionCount: 0,
    };
  }

  const likeOf = (p) => Number(p.like_count) || 0;
  const commentOf = (p) => Number(p.comments_count) || 0;
  const absEng = (p) => likeOf(p) + commentOf(p);
  const perPostER = (p) => (F > 0 ? (absEng(p) / F) * 100 : 0);

  // engagement rate — identical math to ig_discovery.py L103-105
  const total = posts.reduce((s, p) => s + absEng(p), 0);
  const engagementRateMean = F > 0 ? round((total / N) / F * 100, 2) : null;

  const perPost = posts.map(perPostER);
  const engagementRateMedian = round(median(perPost), 2);

  const avgLikes = round(posts.reduce((s, p) => s + likeOf(p), 0) / N, 2);
  const avgComments = round(posts.reduce((s, p) => s + commentOf(p), 0) / N, 2);
  const commentToLikeRatio = avgLikes > 0 ? round(avgComments / avgLikes, 4) : 0;

  const sd = stdevPop(perPost);
  const engagementStdev = round(sd, 2);
  const engagementCV = engagementRateMean > 0 ? round(sd / engagementRateMean, 2) : 0;

  const absList = posts.map(absEng);
  const medAbs = median(absList);
  const topPostToMedianRatio = medAbs > 0 ? round(Math.max(...absList) / medAbs, 2) : null;

  const viralReachFlag = posts.some((p) => likeOf(p) > F && F > 0);

  // content mix
  const buckets = { reel: 0, feedImage: 0, feedVideo: 0, carousel: 0 };
  const reelER = [];
  const feedER = [];
  for (const p of posts) {
    const b = classifyPost(p);
    buckets[b] += 1;
    if (b === 'reel') reelER.push(perPostER(p));
    else feedER.push(perPostER(p));
  }
  const contentMix = {
    reel: round((buckets.reel / N) * 100, 2),
    feedImage: round((buckets.feedImage / N) * 100, 2),
    feedVideo: round((buckets.feedVideo / N) * 100, 2),
    carousel: round((buckets.carousel / N) * 100, 2),
  };
  const reelAvgEngagement = reelER.length ? round(mean(reelER), 2) : null;
  const feedAvgEngagement = feedER.length ? round(mean(feedER), 2) : null;

  // posting cadence from timestamps
  const times = posts
    .map((p) => Date.parse(fixTz(p.timestamp)))
    .filter((t) => Number.isFinite(t));
  let postsPerWeek = null;
  let daysSinceLastPost = null;
  let postSpanDays = null;
  let postingCadence = null;
  if (times.length) {
    const maxT = Math.max(...times);
    const minT = Math.min(...times);
    postSpanDays = round((maxT - minT) / 86400000, 0);
    daysSinceLastPost = round((Date.now() - maxT) / 86400000, 0);
    if (times.length >= 2 && maxT > minT) {
      postsPerWeek = round(times.length / ((maxT - minT) / 86400000 / 7), 2);
    }
    if (daysSinceLastPost > 30) postingCadence = 'dormant';
    else if (postsPerWeek == null) postingCadence = null;
    else if (postsPerWeek >= 4) postingCadence = 'frequent';
    else if (postsPerWeek >= 1) postingCadence = 'regular';
    else postingCadence = 'occasional';
  }

  // caption signals
  const captioned = posts.map((p) => p.caption).filter((c) => c != null && c !== '');
  let avgCaptionLength = 0;
  let avgHashtagCount = 0;
  let avgMentionCount = 0;
  if (captioned.length) {
    const lens = captioned.map((c) => c.length);
    const tags = captioned.map((c) => (c.match(/#[\p{L}\p{N}_]+/gu) || []).length);
    const mentions = captioned.map((c) => (c.match(/@[A-Za-z0-9._]+/g) || []).length);
    avgCaptionLength = round(mean(lens), 1);
    avgHashtagCount = round(mean(tags), 2);
    avgMentionCount = round(mean(mentions), 2);
  }

  return {
    engagementRateMean,
    engagementRateMedian,
    avgLikes,
    avgComments,
    commentToLikeRatio,
    engagementStdev,
    engagementCV,
    topPostToMedianRatio,
    viralReachFlag,
    followerFollowingRatio,
    followerTier: tier,
    contentMix,
    reelAvgEngagement,
    feedAvgEngagement,
    postsPerWeek,
    daysSinceLastPost,
    postingCadence,
    postSpanDays,
    avgCaptionLength,
    avgHashtagCount,
    avgMentionCount,
  };
}

// ---- category inference (keyword heuristic) -------------------------------
const ARTIST_KEYWORDS = [
  'music', 'musician', 'artist', 'singer', 'songwriter', 'producer', 'dj',
  'band', 'rapper', 'composer', 'studio', 'album', ' ep ', 'single', 'out now',
  'new music', 'spotify', 'apple music', 'soundcloud', 'tour', 'on tour',
  'livemusic', 'vocalist', 'beatmaker', 'stream now', 'gig', 'record label',
  'releasing', 'lyrics', 'guitarist', 'pianist', 'drummer',
];
const INFLUENCER_KEYWORDS = [
  'influencer', 'creator', 'content creator', 'lifestyle', 'fashion', 'beauty',
  'makeup', 'fitness', 'travel', 'blogger', 'vlog', 'brand partner', 'ambassador',
  'sponsored', 'paid partnership', 'collab', 'link in bio', 'use my code',
  'discount', 'affiliate', 'shop my', 'haul', 'grwm', 'ootd', 'foodie',
  'dm for collabs', 'review', 'creators', 'digital creator',
];
const MUSIC_DOMAINS = ['spotify', 'apple', 'soundcloud', 'bandcamp', 'audiomack'];
const COMMERCE_CUES = ['link in bio', 'use my code', 'shop', 'discount', 'affiliate', 'collab'];

export function inferCategory(raw, metrics, filedType) {
  const bio = (raw.biography || '').toLowerCase();
  const captions = (raw.media || [])
    .map((m) => (m.caption || '').toLowerCase())
    .join(' \n ');
  const text = `${bio} \n ${captions}`;

  const score = { artist: 0, influencer: 0 };
  const matched = { artist: [], influencer: [] };

  for (const k of ARTIST_KEYWORDS) {
    if (text.includes(k)) { score.artist += 1; matched.artist.push(k.trim()); }
  }
  for (const k of INFLUENCER_KEYWORDS) {
    if (text.includes(k)) { score.influencer += 1; matched.influencer.push(k.trim()); }
  }

  // content-mix signal: reel-heavy leans influencer
  if (metrics && metrics.contentMix && metrics.contentMix.reel >= 60) {
    score.influencer += 1;
    matched.influencer.push(`reel-heavy ${metrics.contentMix.reel}%`);
  }
  // website domain signal: music platforms lean artist
  const site = (raw.website || '').toLowerCase();
  if (site && MUSIC_DOMAINS.some((d) => site.includes(d))) {
    score.artist += 2;
    matched.artist.push('music website');
  }
  // commercial cues in bio lean influencer
  if (COMMERCE_CUES.some((c) => bio.includes(c))) {
    score.influencer += 1;
    matched.influencer.push('commercial bio');
  }

  let inferredType = null;
  if (score.artist === 0 && score.influencer === 0) {
    inferredType = null;
  } else if (score.artist > score.influencer) {
    inferredType = 'artist';
  } else if (score.influencer > score.artist) {
    inferredType = 'influencer';
  } else {
    inferredType = filedType; // tie -> trust the filed type (no mismatch)
  }

  const categoryMismatch = inferredType != null && inferredType !== filedType;

  let inferReason;
  if (inferredType == null) {
    inferReason = 'insufficient signal in bio/captions';
  } else {
    const hits = matched[inferredType].slice(0, 5).join(', ') || 'mixed signals';
    inferReason = `leans ${inferredType} (matched: ${hits})`;
  }

  return { inferredType, categoryMismatch, inferReason, inferScore: score };
}

// ---- helpers --------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function round(x, d) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function stdevPop(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}
function classifyPost(p) {
  const mpt = String(p.media_product_type || '').toUpperCase();
  const mt = String(p.media_type || '').toUpperCase();
  if (mpt === 'REELS' || mpt === 'IGTV') return 'reel';
  if (mt === 'CAROUSEL_ALBUM') return 'carousel';
  if (mt === 'VIDEO') return 'feedVideo';
  return 'feedImage';
}
// Graph returns timestamps like "2026-06-20T18:00:00+0000"; add the colon so
// Date.parse is reliable across engines.
function fixTz(ts) {
  if (!ts) return '';
  return String(ts).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}
