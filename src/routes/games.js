// src/routes/games.js
// Express router that powers all game search, distinct lists, GOTY integration,
// recommendations, raw aggregation execution (with guardrails), and single-item fetches.
// This module interacts with MongoDB through the Mongoose models Game and Goty.

import { Router } from "express";
import mongoose from "mongoose";
import Game from "../models/Game.js";
import Goty from "../models/Goty.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* Utils: diacritic-insensitive regex                                         */
/* -------------------------------------------------------------------------- */

/**
 * Escape RegExp metacharacters to safely embed arbitrary text inside regexes.
 * @param {string} s - Raw user text or term.
 * @returns {string} - Escaped string that can be safely used inside new RegExp().
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mapping from a base Latin letter to a string of common diacritic variants.
 * Used to build accent-insensitive character classes for search inputs.
 */
const DIACRITIC_MAP = {
  a: "aàáâäãåāăą",
  c: "cçćčĉ",
  d: "dďđ",
  e: "eèéêëēĕėę",
  g: "gğĝ",
  h: "hĥȟ",
  i: "iìíîïīĭį",
  l: "lĺļľł",
  n: "nñńňņ",
  o: "oòóôöõōŏő",
  r: "rŕŗř",
  s: "sßśšşș",
  t: "tţťț",
  u: "uùúûüūŭůű",
  y: "yýÿŷ",
  z: "zźżž",
};

/**
 * Convert a plain string to a diacritic-insensitive regex pattern.
 * Example: "cafe" -> "[cç][aàáâäãåāăą]f[eèéêëēĕėę]"
 * - Letters with known diacritics become character classes.
 * - Other characters are escaped literally.
 * @param {string} source - Input text (e.g., search term).
 * @returns {string} - Regex pattern string (not a RegExp object).
 */
function toDiacriticRegex(source) {
  const chars = String(source).split("");
  const out = chars.map((ch) => {
    const low = ch.toLowerCase();
    if (DIACRITIC_MAP[low]) {
      const cls = DIACRITIC_MAP[low].split("").map(escapeRegExp).join("");
      return `[${cls}]`;
    }
    return escapeRegExp(ch);
  });
  return out.join("");
}

/* -------------------------------------------------------------------------- */
/* Helper: Kid-safety exclusion conditions (OBJECT TAGS FIX)                  */
/* -------------------------------------------------------------------------- */

/**
 * Build a MongoDB condition that excludes adult/violent content for the "kid" profile.
 *
 * IMPORTANT SHAPE NOTE:
 * - `tags` are stored as an OBJECT (e.g. { "Nudity": 100, "Violent": 50, ... }),
 *   not as an array. We therefore check tag PRESENCE via dotted-path `$exists:true`.
 *
 * Coverage:
 * - Excludes bad words across categories/genres (arrays of strings).
 * - Excludes when any bad tag exists as a key in `tags` object.
 * - Excludes when `steamspy_tags` (string or array) matches bad terms.
 * - Excludes titles/developers/publishers containing problematic terms (regex).
 * - Excludes by explicit age rating (required_age >= 18).
 *
 * Returned shape:
 * - `{ $nor: [ ...conditions... ] }` so ANY of these signals will exclude a game.
 *
 * @returns {import("mongodb").Filter<unknown>} MongoDB NOR-based filter.
 */
function getKidSafetyFilter() {
  const badTags = [
    // Explicit adult content
    "Sexual Content", "Nudity", "Mature", "Adult", "NSFW",
    "Hentai", "Porn", "Erotic", "XXX", "Ecchi", "Loli",
    // Soft signals that often accompany adult content
    "Dating Sim", "Romance", "Anime",
    // Violence
    "Violent", "Gore", "Blood", "Brutal",
    // Often adult-heavy genre in this dataset
    "Visual Novel",
  ];

  const norConditions = [];

  // CATEGORIES / GENRES (arrays of strings)
  norConditions.push({ categories: { $in: badTags } });
  norConditions.push({ genres: { $in: badTags } });

  // TAGS (object): exclude if any bad tag is present as a key
  badTags.forEach(tag => {
    norConditions.push({ [`tags.${tag}`]: { $exists: true } });
  });

  // STEAMSPY_TAGS (string or array) — handle both equality and regex match
  const rxBadTags = new RegExp(badTags.map(w => toDiacriticRegex(w)).join("|"), "i");
  norConditions.push({ steamspy_tags: { $in: badTags } });
  norConditions.push({ steamspy_tags: rxBadTags });

  // GAME TITLE (fuzzy)
  const badTitleWords = [
    "Hentai", "Porn", "Sex", "Nude", "Nudity", "Erotic", "XXX", "NSFW",
    "Loli", "Ecchi", "Waifu", "Gore", "Violent",
    // Specific examples known to be adult-themed in some datasets
    "Funbag", "Meltys", "NEKOMIMI", "Unlock Me", "Deep Space Waifu",
    "Tower of Five Hearts", "K Station", "Kara no Shojo"
  ];
  const rxBadName = new RegExp(badTitleWords.map(w => toDiacriticRegex(w)).join("|"), "i");
  norConditions.push({ name: rxBadName });

  // DEVELOPERS (array) — exclude by literal membership or fuzzy regex
  const badDevTerms = [
    "NSFW", "Hentai", "Adult", "Erotic",
    "Waffle", "MangaGamer", "TsukiWare",
    "Remtairy", "Kagura Games", "Neko Climax",
    "Maya Games", "Perpetual FX Creative"
  ];
  const rxBadDev = new RegExp(badDevTerms.map(w => toDiacriticRegex(w)).join("|"), "i");
  norConditions.push({ developers: { $in: badDevTerms } });
  norConditions.push({ developers: rxBadDev });

  // PUBLISHERS (array)
  const badPubTerms = ["MangaGamer", "Kagura Games", "Maya Games", "Remtairy", "Neko Climax"];
  const rxBadPub = new RegExp(badPubTerms.map(w => toDiacriticRegex(w)).join("|"), "i");
  norConditions.push({ publishers: { $in: badPubTerms } });
  norConditions.push({ publishers: rxBadPub });

  // AGE RATING (numeric)
  norConditions.push({ required_age: { $gte: 18 } });

  return { $nor: norConditions };
}

/* -------------------------------------------------------------------------- */
/* Helper: Extract favorite-derived characteristics for recommendations       */
/* -------------------------------------------------------------------------- */

/**
 * Inspect the user's favorite games and compute preference signals:
 * - Top genres / languages / developers / categories (by frequency)
 * - Price stats (average, min, max)
 *
 * For the "kid" profile, the analysis itself is restricted to kid-safe favorites.
 *
 * @param {Array<string>} appids - Favorite Steam app IDs (strings or coercible).
 * @param {string} [profile="person1"] - Active profile id; affects kid-safe filtering.
 * @returns {Promise<{
 *   topGenres: string[],
 *   topLanguages: string[],
 *   topDevelopers: string[],
 *   topCategories: string[],
 *   avgPrice: number|null,
 *   minPrice: number|null,
 *   maxPrice: number|null
 * } | null>}
 */
async function getFavoriteCharacteristics(appids, profile = "person1") {
  if (!Array.isArray(appids) || appids.length === 0) return null;

  const query = { appid: { $in: appids.map(String) } };
  // For kid profile: ensure even the favorites inspected are kid-safe
  if (String(profile) === "kid") {
    Object.assign(query, getKidSafetyFilter());
  }

  const favorites = await Game.find(query)
    .select("genres supported_languages developers categories price")
    .lean();
  // MongoDB (shell) equivalent of the query above:
  // db.games.find(
  //   { appid: { $in: ["<id1>","<id2>", "..."] }, /* + getKidSafetyFilter() if profile==="kid" */ },
  //   { genres: 1, supported_languages: 1, developers: 1, categories: 1, price: 1 }
  // )

  if (favorites.length === 0) return null;

  // Frequency maps
  const genresMap = {};
  const languagesMap = {};
  const developersMap = {};
  const categoriesMap = {};
  const prices = [];

  favorites.forEach(game => {
    if (Array.isArray(game.genres)) game.genres.forEach(g => { genresMap[g] = (genresMap[g] || 0) + 1; });
    if (Array.isArray(game.supported_languages)) game.supported_languages.forEach(l => { languagesMap[l] = (languagesMap[l] || 0) + 1; });
    if (Array.isArray(game.developers)) game.developers.forEach(d => { developersMap[d] = (developersMap[d] || 0) + 1; });
    if (Array.isArray(game.categories)) game.categories.forEach(c => { categoriesMap[c] = (categoriesMap[c] || 0) + 1; });
    if (game.price != null) prices.push(Number(game.price));
  });

  const topGenres = Object.entries(genresMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([g])=>g);
  const topLanguages = Object.entries(languagesMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([l])=>l);
  const topDevelopers = Object.entries(developersMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([d])=>d);
  const topCategories = Object.entries(categoriesMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c])=>c);

  const avgPrice = prices.length ? prices.reduce((s,p)=>s+p,0) / prices.length : null;
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  return { topGenres, topLanguages, topDevelopers, topCategories, avgPrice, minPrice, maxPrice };
}

/* -------------------------------------------------------------------------- */
/* Utils: translate frontend filters to a MongoDB $match                      */
/* -------------------------------------------------------------------------- */

/**
 * Convert the filter object sent by the frontend into a MongoDB condition.
 * - Applies text search (accent-insensitive) across name/developers/genres.
 * - Applies category presets (favorites/best/recommendations placeholder).
 * - Applies platform/genre/language/developer/multiplayer/price constraints.
 * - If profile === "kid", injects the kid-safety exclusion block.
 *
 * NOTE: "recommendations" is handled elsewhere; here we only avoid filtering it out.
 *
 * @param {Record<string, any>} f - Raw filters from the client.
 * @returns {import("mongodb").Filter<unknown>} - Combined $and/$or tree for $match.
 */
function buildMatch(f = {}) {
  const and = [];

  // Text search across several fields, accent-insensitive using our char-class builder
  if (f.search && String(f.search).trim()) {
    const pattern = toDiacriticRegex(String(f.search).trim());
    const rx = new RegExp(pattern, "i");
    and.push({ $or: [{ name: rx }, { developers: rx }, { genres: rx }] });
  }

  // Category presets that translate to simple filters (non-recommendations)
  switch (f.category) {
    case "favorites":
      // If the frontend already provided explicit appids, we won't rely on a boolean flag.
      if (!(Array.isArray(f.appids) && f.appids.length)) {
        and.push({ favorite: true });
      }
      break;
    case "best":
      and.push({ user_score: { $gte: 80 } });
      break;
    case "recommendations":
      // Scoring-based; handled in a separate pipeline
      break;
    // "goty" is filtered after a $lookup joins GOTY data (see gotyJoinStages)
    default:
      break;
  }

  // Platforms (OR across selected platforms)
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac || f.mac === "1") ors.push({ mac: true });
  if (f.platforms?.linux || f.linux === "1") ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  // Genre / Language dropdowns
  if (f.genre) and.push({ genres: f.genre });
  if (f.language) and.push({ supported_languages: f.language });

  // Explicit favorites by appids (used by favorites & recommendations)
  if (Array.isArray(f.appids) && f.appids.length) {
    const ids = f.appids.map(v => String(v));
    and.push({ appid: { $in: ids } });
  }

  // Multiplayer mode (Steam categories naming)
  if (f.multiplayer === "single") and.push({ categories: "Single-player" });
  if (f.multiplayer === "multi")  and.push({ categories: "Multi-player" });

  // Developer filter supports exact match OR diacritic-insensitive regex
  if (f.developer) {
    const dev = String(f.developer).trim();
    const devPattern = new RegExp(toDiacriticRegex(dev), "i");
    and.push({ $or: [{ developers: dev }, { developers: devPattern }] });
  }

  // Price bounds (always enforced; the frontend provides defaults)
  const min = f.priceMin != null ? Number(f.priceMin) : 0;
  const max = f.priceMax != null ? Number(f.priceMax) : 999999;
  and.push({ price: { $gte: min, $lte: max } });

  // Kid profile: apply global exclusions
  if (String(f.profile) === "kid") {
    and.push(getKidSafetyFilter());
  }

  if (!and.length) return {};
  return and.length === 1 ? and[0] : { $and: and };
}

/* -------------------------------------------------------------------------- */
/* Build recommendation $match (requires overlap)                              */
/* -------------------------------------------------------------------------- */

/**
 * Construct a recommendation-oriented $match:
 * - Requires at least one overlapping genre with the favorite-derived profile,
 *   falling back to categories if no genres are available.
 * - Excludes already-favorited appids.
 * - Applies platform and kid-safety constraints as needed.
 *
 * @param {Record<string, any>} f - Filters with at least `appids` and `profile`.
 * @returns {Promise<import("mongodb").Filter<unknown> | null>} - A match filter,
 *          or null when we cannot produce meaningful recommendations (no favorites).
 */
async function buildRecommendationMatch(f = {}) {
  const and = [];

  const favAppids = Array.isArray(f.appids) && f.appids.length ? f.appids : [];
  const profile = String(f.profile || "person1");
  if (!favAppids.length) return null;

  // Kid safety first to prune the pool early
  if (profile === "kid") {
    and.push(getKidSafetyFilter());
  }

  const characteristics = await getFavoriteCharacteristics(favAppids, profile);
  if (!characteristics) {
    // With kid profile, we can still return a basic safety-only match (very broad)
    if (profile === "kid") return { $and: and };
    return null;
  }

  // Don't recommend what the user already likes
  and.push({ appid: { $nin: favAppids.map(String) } });

  // Require some similarity: at least one genre (preferred) or category overlap
  if (characteristics.topGenres.length > 0) {
    and.push({ genres: { $in: characteristics.topGenres } });
  } else if (characteristics.topCategories.length > 0) {
    and.push({ categories: { $in: characteristics.topCategories } });
  }

  // Respect platform selections
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac || f.mac === "1") ors.push({ mac: true });
  if (f.platforms?.linux || f.linux === "1") ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  if (!and.length) return {};
  return { $and: and };
}

/* -------------------------------------------------------------------------- */
/* Build recommendation scoring ($addFields with weighted components)          */
/* -------------------------------------------------------------------------- */

/**
 * Create an $addFields stage that attaches per-document scores and a
 * `recommendationScore` computed from weighted components. Higher is better.
 *
 * Components (weights chosen to emphasize genre similarity):
 * - genreScore:     100 pts per overlapping genre
 * - catScore:       30  pts per overlapping category
 * - devScore:       20  pts per overlapping developer
 * - langScore:      10  pts per overlapping language
 * - priceScore:     0..10 based on closeness to average favorite price
 * - rating bonus:   user_score / 20  (0..5 when user_score in 0..100)
 *
 * @param {Array<string>} favAppids - Not used in scoring here, but kept for parity/extension.
 * @param {ReturnType<typeof getFavoriteCharacteristics>} characteristics - Extracted signals.
 * @returns {Promise<Array<import("mongodb").Document>>} One or more $addFields stages.
 */
async function buildRecommendationScoring(favAppids, characteristics) {
  if (!characteristics) return [];

  const scoreFields = {};

  // Overlap counts via $setIntersection with null-safe arrays
  if (characteristics.topGenres.length > 0) {
    scoreFields.genreScore = {
      $size: {
        $ifNull: [
          { $setIntersection: [{ $ifNull: ["$genres", []] }, characteristics.topGenres] },
          []
        ]
      }
    };
  }

  if (characteristics.topCategories.length > 0) {
    scoreFields.catScore = {
      $size: {
        $ifNull: [
          { $setIntersection: [{ $ifNull: ["$categories", []] }, characteristics.topCategories] },
          []
        ]
      }
    };
  }

  if (characteristics.topDevelopers.length > 0) {
    scoreFields.devScore = {
      $size: {
        $ifNull: [
          { $setIntersection: [{ $ifNull: ["$developers", []] }, characteristics.topDevelopers] },
          []
        ]
      }
    };
  }

  if (characteristics.topLanguages.length > 0) {
    scoreFields.langScore = {
      $size: {
        $ifNull: [
          { $setIntersection: [{ $ifNull: ["$supported_languages", []] }, characteristics.topLanguages] },
          []
        ]
      }
    };
  }

  // Price similarity: linear penalty by distance from favorite average, capped
  if (characteristics.avgPrice != null) {
    scoreFields.priceScore = {
      $cond: {
        if: { $and: [
          { $gte: ["$price", 0] },
          // crude upper bound to avoid rewarding extreme outliers
          { $lte: ["$price", { $multiply: [characteristics.avgPrice, 3] }] }
        ]},
        then: {
          $subtract: [
            10,
            {
              $min: [
                10,
                {
                  $divide: [
                    { $abs: { $subtract: ["$price", characteristics.avgPrice] } },
                    { $add: [characteristics.avgPrice, 1] } // avoid division by zero
                  ]
                }
              ]
            }
          ]
        },
        else: 0
      }
    };
  }

  // Weighted sum: genre dominates, then category/dev/lang, then price & rating bonus
  scoreFields.recommendationScore = {
    $add: [
      { $multiply: [{ $ifNull: ["$genreScore", 0] }, 100] },
      { $multiply: [{ $ifNull: ["$catScore", 0] }, 30] },
      { $multiply: [{ $ifNull: ["$devScore", 0] }, 20] },
      { $multiply: [{ $ifNull: ["$langScore", 0] }, 10] },
      { $ifNull: ["$priceScore", 0] },
      { $divide: [{ $ifNull: ["$user_score", 0] }, 20] },
    ]
  };

  return [{ $addFields: scoreFields }];
}

/* -------------------------------------------------------------------------- */
/* Utils: Build $sort                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Translate a sort key into a MongoDB sort object.
 * For recommendation queries, score takes precedence, then rating, then name.
 *
 * @param {string} [sortKey="name-asc"] - Frontend sort key.
 * @param {boolean} [isRecommendation=false] - If true, sort by recommendationScore.
 * @returns {Record<string, 1|-1>} - $sort document.
 */
function buildSort(sortKey = "name-asc", isRecommendation = false) {
  if (isRecommendation) {
    return { recommendationScore: -1, user_score: -1, name: 1 };
  }
  return ({
    "name-asc":  { name: 1 },
    "name-desc": { name: -1 },
    "price-asc": { price: 1 },
    "price-desc":{ price: -1 },
    "date-desc": { release_date_parsed: -1 },
    "date-asc":  { release_date_parsed: 1 },
    "rating-desc": { user_score: -1 },
  }[sortKey] || { name: 1 });
}

/* -------------------------------------------------------------------------- */
/* Utils: Build projection                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a projection argument into a MongoDB $project document.
 * If no custom projection is provided, return a small default selection.
 *
 * @param {Record<string, 0|1>} reqProjection - Optional request-driven projection.
 * @returns {Record<string, 0|1>} - Field inclusion/exclusion map.
 */
function buildProjectList(reqProjection) {
  if (reqProjection && typeof reqProjection === "object") return reqProjection;
  return { name: 1, header_image: 1, genres: 1, price: 1 };
}

/* -------------------------------------------------------------------------- */
/* Helper: GOTY join                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Add a left-join to the per-profile GOTY collection and expose `goty_year`.
 * This is used both to display a badge in results and to filter the GOTY tab.
 *
 * @param {string} [profile="person1"] - Active profile id.
 * @returns {import("mongodb").Document[]} - Aggregation stages ($lookup/$addFields/$project).
 */
function gotyJoinStages(profile = "person1") {
  // MongoDB (shell) equivalent inside an aggregate:
  // { $lookup: {
  //     from: "gotys",
  //     let: { app: "$appid" },
  //     pipeline: [
  //       { $match: {
  //           $expr: {
  //             $and: [
  //               { $eq: ["$appid", "$$app"] },
  //               { $eq: ["$profile", String(profile || "person1")] }
  //             ]
  //           }
  //         }
  //       },
  //       { $project: { _id: 0, year: 1 } },
  //       { $limit: 1 }
  //     ],
  //     as: "gotyP"
  // } },
  // { $addFields: { goty_year: { $ifNull: [ { $arrayElemAt: ["$gotyP.year", 0] }, null ] } } },
  // { $project: { gotyP: 0 } }
  return [
    {
      $lookup: {
        from: "gotys",
        let: { app: "$appid" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$appid", "$$app"] },
                  { $eq: ["$profile", String(profile || "person1")] },
                ],
              },
            },
          },
          { $project: { _id: 0, year: 1 } },
          { $limit: 1 },
        ],
        as: "gotyP",
      },
    },
    { $addFields: { goty_year: { $ifNull: [{ $arrayElemAt: ["$gotyP.year", 0] }, null] } } },
    { $project: { gotyP: 0 } },
  ];
}

/* -------------------------------------------------------------------------- */
/* Pipeline builder: search/favorites/recommendations/GOTY + pagination       */
/* -------------------------------------------------------------------------- */

/**
 * Assemble a complete aggregation pipeline that:
 * - Parses and adds a sortable `release_date_parsed` (from string).
 * - Applies $match (standard or recommendation-specific).
 * - Adds recommendation scoring (if applicable).
 * - Joins GOTY and optionally filters to GOTY-only view.
 * - Uses $facet to return both `items` and `total` on the first page.
 *
 * @param {Object} options
 * @param {Record<string, any>} options.filters
 * @param {string} options.sort
 * @param {number} options.page
 * @param {number} options.limit
 * @param {Record<string, 0|1>} options.projection
 * @returns {Promise<import("mongodb").Document[]>} Aggregation pipeline array.
 */
async function buildSearchPipeline({
  filters = {},
  sort = "name-asc",
  page = 1,
  limit = 40,
  projection,
} = {}) {
  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const profile = String(filters.profile || "person1");
  const isRecommendation = filters.category === "recommendations";

  let $match;
  let scoringStages = [];
  let characteristics = null;

  if (isRecommendation) {
    // Recommendation flavor: match + scoring based on favorites-derived profile
    const favAppids = Array.isArray(filters.appids) && filters.appids.length ? filters.appids : [];
    characteristics = favAppids.length ? await getFavoriteCharacteristics(favAppids, profile) : null;
    $match = await buildRecommendationMatch(filters);

    if (!$match) {
      // Return an empty facet structure when we cannot provide recs
      return [
        { $match: { _id: null } },
        {
          $facet: {
            items: [],
            meta: [{ $count: "total" }],
          },
        },
        { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
        { $addFields: { total: 0 } },
        { $project: { meta: 0 } },
      ];
    }

    scoringStages = await buildRecommendationScoring(filters.appids, characteristics);
  } else {
    $match = buildMatch(filters);
  }

  const $sort = buildSort(sort, isRecommendation);
  const $project = buildProjectList(projection);

  const base = [
    // Normalize `release_date` (string) into a Date for server-side sorting
    {
      $addFields: {
        release_date_parsed: {
          $dateFromString: {
            dateString: "$release_date",
            format: "%b %d, %Y",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    Object.keys($match).length ? { $match } : null,
    ...scoringStages,
    ...gotyJoinStages(profile),
  ].filter(Boolean);

  // GOTY tab-specific filter (after join so we have goty_year)
  const postMatch = [];
  if (filters.category === "goty") {
    if (filters.gotyYear) {
      postMatch.push({ $match: { goty_year: Number(filters.gotyYear) } });
    } else {
      postMatch.push({ $match: { goty_year: { $ne: null } } });
    }
  }

  // MongoDB (shell) when this pipeline runs later:
  // db.games.aggregate(
  //   [ ...base, ...postMatch,
  //     { $facet: {
  //         items: [ { $sort: <sort> }, { $skip: <skip> }, { $limit: <limit> }, { $project: <project> } ],
  //         meta: [ { $count: "total" } ]
  //       }
  //     },
  //     { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
  //     { $addFields: { total: { $ifNull: ["$meta.total", 0] } } },
  //     { $project: { meta: 0 } }
  //   ],
  //   { allowDiskUse: true /* and optionally collation, see router.post("/search") */ }
  // )

  return [
    ...base,
    ...postMatch,
    {
      $facet: {
        items: [
          { $sort: $sort },
          { $skip: skip },
          { $limit: Math.max(1, Number(limit)) },
          { $project: $project },
        ],
        meta: [{ $count: "total" }],
      },
    },
    { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
    { $addFields: { total: { $ifNull: ["$meta.total", 0] } } },
    { $project: { meta: 0 } },
  ];
}

/* -------------------------------------------------------------------------- */
/* POST /api/games/search - Main search endpoint                              */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/games/search
 * Unified search endpoint supporting:
 * - Standard filter-based search
 * - Favorites (by appids) and GOTY filtering
 * - Recommendations (genre/category overlap + scoring)
 * - Pagination and optional total counting (only on page 1 by default)
 *
 * Request body:
 * {
 *   filters: {...},       // see buildMatch/buildRecommendationMatch
 *   sort: "name-asc"|..., // see buildSort
 *   page: 1,              // 1-based
 *   limit: 40,
 *   projection: {...},    // optional field projection
 *   withTotal: true|false // usually true for first page only
 * }
 *
 * Response:
 * { ok, page, limit, total|null, hasMore, items: [...] }
 */
router.post("/search", async (req, res) => {
  try {
    const {
      filters = {},
      sort,
      page = 1,
      limit = 40,
      projection,
      withTotal = page === 1, // optimization: count only on the first page
    } = req.body || {};

    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const profile = String(filters.profile || "person1");
    const isRecommendation = filters.category === "recommendations";

    // Build either the full $facet pipeline or a light version (no $count)
    const pipeline = withTotal
      ? await buildSearchPipeline({ filters, sort, page, limit, projection })
      : await (async () => {
          let $match;
          let scoringStages = [];
          let characteristics = null;

          if (isRecommendation) {
            const favAppids = Array.isArray(filters.appids) && filters.appids.length ? filters.appids : [];
            characteristics = favAppids.length ? await getFavoriteCharacteristics(favAppids, profile) : null;
            $match = await buildRecommendationMatch(filters);
            if (!$match) return [{ $match: { _id: null } }];
            scoringStages = await buildRecommendationScoring(filters.appids, characteristics);
          } else {
            $match = buildMatch(filters);
          }

          return [
            {
              $addFields: {
                release_date_parsed: {
                  $dateFromString: {
                    dateString: "$release_date",
                    format: "%b %d, %Y",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            ...(Object.keys($match).length ? [{ $match }] : []),
            ...scoringStages,
            ...gotyJoinStages(profile),
            ...(() => {
              if (filters.category !== "goty") return [];
              if (filters.gotyYear) return [{ $match: { goty_year: Number(filters.gotyYear) } }];
              return [{ $match: { goty_year: { $ne: null } } }];
            })(),
            { $sort: buildSort(sort, isRecommendation) },
            { $skip: skip },
            { $limit: Math.max(1, Number(limit)) },
            { $project: buildProjectList(projection) },
          ];
        })();

    // AllowDiskUse supports large sorts; collation improves text matching
    let agg = Game.aggregate(pipeline).allowDiskUse(true);
    // MongoDB (shell) equivalent:
    // db.games.aggregate(pipeline, { allowDiskUse: true })

    // Apply a locale collation when user provided text terms (case/diacritic-insensitive)
    if (
      (filters && String(filters.search || "").trim()) ||
      (filters && String(filters.developer || "").trim())
    ) {
      // 'es' locale with strength:1 ignores case and accents.
      agg = agg.collation({ locale: "es", strength: 1, caseLevel: false });
      // MongoDB (shell) equivalent (when collation applies):
      // db.games.aggregate(pipeline, {
      //   allowDiskUse: true,
      //   collation: { locale: "es", strength: 1, caseLevel: false }
      // })
    }

    const out = await agg;

    let items = [];
    let total = null;

    if (withTotal) {
      const bucket = out[0] || {};
      items = bucket.items || [];
      total = typeof bucket.total === "number" ? bucket.total : 0;
    } else {
      items = out || [];
    }

    // Infer hasMore either from total (when available) or page size
    const hasMore = total != null
      ? (skip + items.length) < total
      : (items.length === Math.max(1, Number(limit)));

    res.json({
      ok: true,
      page: Number(page),
      limit: Number(limit),
      total,
      hasMore,
      items,
    });
  } catch (err) {
    console.error("POST /api/games/search error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* DISTINCT endpoints - Unique values for UI filters                          */
/* -------------------------------------------------------------------------- */

/**
 * Build a pipeline to compute distinct values for a given array field
 * under the current filters (so options remain relevant to the current view).
 * - Uses $unwind to explode the array.
 * - Trims/coerces to string, removes empties, groups by value, sorts A→Z.
 *
 * @param {"genres"|"supported_languages"|"developers"} field - Array field name.
 * @param {Record<string, any>} filters - Filter context (e.g., profile, kid-safety).
 * @returns {import("mongodb").Document[]} Aggregation pipeline stages.
 */
function buildDistinctPipeline(field, filters = {}) {
  const $match = buildMatch(filters);
  // MongoDB (shell) equivalent when this pipeline is used:
  // db.games.aggregate([
  //   ...(Object.keys($match).length ? [{ $match }] : []),
  //   { $unwind: { path: "$" + field, preserveNullAndEmptyArrays: false } },
  //   { $group: { _id: { $trim: { input: { $toString: "$" + field } } } } },
  //   { $match: { _id: { $ne: "" } } },
  //   { $sort: { _id: 1 } },
  //   { $project: { _id: 0, value: "$_id" } }
  // ])
  return [
    Object.keys($match).length ? { $match } : null,
    { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: false } },
    { $group: { _id: { $trim: { input: { $toString: `$${field}` } } } } },
    { $match: { _id: { $ne: "" } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, value: "$_id" } },
  ].filter(Boolean);
}

/** GET /api/games/distinct/genres — list of genres relevant to current filters. */
router.get("/distinct/genres", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("genres", req.query);
    const rows = await Game.aggregate(pipeline);
    // MongoDB (shell) equivalent:
    // db.games.aggregate(pipeline)
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct genres error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/** GET /api/games/distinct/languages — list of languages relevant to current filters. */
router.get("/distinct/languages", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("supported_languages", req.query);
    const rows = await Game.aggregate(pipeline);
    // MongoDB (shell) equivalent:
    // db.games.aggregate(pipeline)
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct languages error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/** GET /api/games/distinct/developers — list of developers relevant to current filters. */
router.get("/distinct/developers", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("developers", req.query);
    const rows = await Game.aggregate(pipeline);
    // MongoDB (shell) equivalent:
    // db.games.aggregate(pipeline)
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct developers error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* GET /api/games/:id - Fetch a single game by Mongo _id or Steam appid       */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/games/:id
 * Resolve a single game document by:
 * 1) MongoDB ObjectId (if :id is a valid ObjectId), else
 * 2) Steam appid (string equality on Game.appid).
 *
 * Response:
 *  - 200 { ok:true, data:<document> }
 *  - 404 { ok:false, error:"not_found" }
 *  - 500 { ok:false, error:"server_error" }
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (mongoose.isValidObjectId(id)) {
      const g = await Game.findById(id).lean();
      // MongoDB (shell) equivalent:
      // db.games.findOne({ _id: ObjectId("<id>") })
      if (g) return res.json({ ok: true, data: g });
    }

    const g2 = await Game.findOne({ appid: String(id) }).lean();
    // MongoDB (shell) equivalent:
    // db.games.findOne({ appid: "<appid>" })
    if (!g2) return res.status(404).json({ ok: false, error: "not_found" });

    res.json({ ok: true, data: g2 });
  } catch (e) {
    console.error("GET /api/games/:id error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* RAW aggregation endpoint (guarded)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whitelist of allowed aggregation stages to reduce the attack surface.
 * Disallows JS execution stages/operators.
 */
const ALLOWED_STAGES = new Set([
  "$match", "$project", "$sort", "$limit", "$skip",
  "$unwind", "$group", "$lookup", "$addFields", "$set",
  "$facet", "$count", "$sample", "$sortByCount",
  "$unset", "$replaceRoot", "$replaceWith",
  "$setWindowFields"
]);

/** Forbidden operators due to arbitrary code execution risk. */
const FORBIDDEN_KEYS = ["$where", "$function", "$accumulator"];

/**
 * Extract a pipeline array from a mongo shell-like command string.
 * Example input: 'db.games.aggregate([ { "$match": {} } ])'
 * @param {string} cmd - Raw command text.
 * @returns {Array} - Parsed pipeline array.
 * @throws {SyntaxError} - If it cannot detect/parse the array.
 */
function parseCommandToPipeline(cmd) {
  const m = String(cmd).match(/aggregate\s*\(\s*(\[.*\])\s*\)/s);
  if (!m) throw new SyntaxError("bad_aggregate_syntax");
  return JSON.parse(m[1]);
}

/**
 * Validate a pipeline:
 * - Ensures it is an array of single-operator objects (one key per stage).
 * - Ensures each stage operator is whitelisted.
 * - Recursively rejects any use of FORBIDDEN_KEYS inside stage payloads.
 *
 * @param {Array<Record<string, any>>} pipeline - Aggregation pipeline.
 * @throws {Error} - On structural violations or forbidden usage.
 */
function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline)) throw new Error("pipeline_must_be_array");

  const scan = (node) => {
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) {
        if (FORBIDDEN_KEYS.includes(k)) {
          throw new Error(`forbidden_operator: ${k}`);
        }
        scan(node[k]);
      }
    }
  };

  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object") throw new Error("stage_must_be_object");
    const keys = Object.keys(stage);
    if (keys.length !== 1) throw new Error("one_operator_per_stage");
    const op = keys[0];
    if (!ALLOWED_STAGES.has(op)) throw new Error(`stage_not_allowed: ${op}`);
    scan(stage[op]);
  }
}

/**
 * POST /api/games/agg
 * Execute a custom aggregation against the games collection.
 *
 * Security controls:
 * - Only a safe subset of stages is allowed (ALLOWED_STAGES).
 * - Pipelines are validated to reject $where/$function/$accumulator.
 * - Optional timeouts and allowDiskUse are applied to the operation.
 *
 * Request body:
 * {
 *   pipeline?: Array,                 // direct JSON pipeline
 *   command?: string,                 // or a shell-like string with aggregate([...])
 *   allowDiskUse?: boolean = true,
 *   maxTimeMS?: number = 5000
 * }
 *
 * Response:
 * { ok:true, items:[...] } on success.
 * { ok:false, error:<reason> } on validation/syntax errors (HTTP 400).
 */
router.post("/agg", async (req, res) => {
  try {
    const { pipeline, command, allowDiskUse = true, maxTimeMS = 5000 } = req.body || {};
    const pipe = pipeline ? pipeline : parseCommandToPipeline(command);

    validatePipeline(pipe);

    const cursor = Game.aggregate(pipe, { allowDiskUse }).option({ maxTimeMS });
    // MongoDB (shell) equivalent:
    // db.games.aggregate(pipe, { allowDiskUse: true, maxTimeMS: 5000 })
    const items = await cursor.exec();

    res.json({ ok: true, items });
  } catch (e) {
    console.error("RAW AGG error:", e);
    const msg = e instanceof SyntaxError ? "syntax_error" : e.message || "server_error";
    res.status(400).json({ ok: false, error: msg });
  }
});

/* -------------------------------------------------------------------------- */
/* GOTY endpoints (SET/UNSET with upsert & validation)                        */
/* -------------------------------------------------------------------------- */

/**
 * Resolve allowed profiles from the Goty schema enum dynamically.
 * This helps keep the router aligned with the model without hardcoding values.
 */
function getAllowedProfiles() {
  // Mongoose may expose enum values under `options.enum` or `enumValues`
  const path = Goty?.schema?.path?.("profile");
  const enumA = path?.options?.enum;
  const enumB = path?.enumValues;
  const list = Array.isArray(enumA) && enumA.length ? enumA : (Array.isArray(enumB) && enumB.length ? enumB : null);
  // Fallback (kept for backwards-compatibility if the schema lacks enum)
  return Array.isArray(list) && list.length ? list.map(String) : ["kid", "person1", "person2"];
}

/**
 * POST /api/games/goty/set
 * Create or replace the GOTY for a (profile, year) pair. This uses an UPSERT to
 * avoid duplicate-key errors against the unique compound index (profile, year).
 *
 * Body: { appid: string, year: number, profile: string }
 * Success: { ok:true, goty:{...} }
 */
router.post("/goty/set", async (req, res, next) => {
  try {
    let { appid, year, profile } = req.body || {};

    // Basic normalization
    appid = String(appid || "").trim();
    const y = Number(year);
    profile = String(profile || "").trim();

    // Basic validation before hitting Mongoose validators
    if (!appid) return res.status(400).json({ ok: false, error: "missing_appid" });
    if (!Number.isInteger(y)) return res.status(400).json({ ok: false, error: "invalid_year" });

    const allowed = getAllowedProfiles();
    if (!allowed.includes(profile)) {
      // Early feedback if the profile is not in the enum (or fallback list)
      return res.status(400).json({ ok: false, error: "invalid_profile", allowed });
    }

    // Upsert to guarantee a single GOTY per (profile,year)
    const doc = await Goty.findOneAndUpdate(
      { profile, year: y },
      { $set: { appid, profile, year: y } },
      {
        upsert: true,
        new: true,
        runValidators: true,         // honor schema validation & enum
        setDefaultsOnInsert: true,
        context: "query",
      }
    ).lean();
    // MongoDB (shell) equivalent:
    // db.gotys.updateOne(
    //   { profile: "<profile>", year: <year> },
    //   { $set: { appid: "<appid>", profile: "<profile>", year: <year> } },
    //   { upsert: true }
    // )

    return res.json({ ok: true, goty: doc });
  } catch (err) {
    // Friendly duplicate-key handling just in case (rare due to upsert)
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: "duplicate_goty", detail: err.keyValue });
    }
    next(err);
  }
});

/**
 * POST /api/games/goty/unset
 * Remove the GOTY record by (profile + year) OR (profile + appid).
 *
 * Body: { profile: string, year?: number, appid?: string }
 * Success: { ok:true, removed:{...} }
 */
router.post("/goty/unset", async (req, res, next) => {
  try {
    let { year, appid, profile } = req.body || {};
    profile = String(profile || "").trim();
    const y = year !== undefined ? Number(year) : undefined;
    appid = appid !== undefined ? String(appid).trim() : undefined;

    const allowed = getAllowedProfiles();
    if (!allowed.includes(profile)) {
      return res.status(400).json({ ok: false, error: "invalid_profile", allowed });
    }
    if (y === undefined && !appid) {
      return res.status(400).json({ ok: false, error: "missing_selector" });
    }
    if (y !== undefined && !Number.isInteger(y)) {
      return res.status(400).json({ ok: false, error: "invalid_year" });
    }

    const filter = { profile };
    if (appid) filter.appid = appid;
    if (y !== undefined) filter.year = y;

    const out = await Goty.findOneAndDelete(filter).lean();
    // MongoDB (shell) equivalent:
    // db.gotys.findOneAndDelete(<filter>)
    if (!out) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, removed: out });
  } catch (err) {
    next(err);
  }
});

export default router;
