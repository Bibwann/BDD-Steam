// src/routes/games.js

import { Router } from "express";
import mongoose from "mongoose";
import Game from "../models/Game.js";
import Goty from "../models/Goty.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* Utils: diacritic-insensitive regex                                         */
/* -------------------------------------------------------------------------- */

/**
 * Escapes special regex characters in a string.
 * @param {string} s - The string to escape
 * @returns {string} - Escaped string safe for regex
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mapping of base characters to their diacritic variants.
 * Used for accent-insensitive searches.
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
 * Converts a string into a diacritic-insensitive regex pattern.
 * Example: "cafe" becomes "[cç][aàáâ][fḟ][eèéê]"
 * @param {string} source - The input string
 * @returns {string} - Regex pattern string
 */
function toDiacriticRegex(source) {
  const chars = String(source).split("");
  const out = chars.map((ch) => {
    const low = ch.toLowerCase();
    if (DIACRITIC_MAP[low]) {
      const cls = DIACRITIC_MAP[low].split("")
        .map(escapeRegExp)
        .join("");
      return `[${cls}]`;
    }
    return escapeRegExp(ch);
  });
  return out.join("");
}

/* -------------------------------------------------------------------------- */
/* Helper: Get kid safety filter conditions (FIXED FOR OBJECT TAGS)           */
/* -------------------------------------------------------------------------- */

/**
 * Returns kid profile safety exclusion conditions.
 * CRITICAL FIX: Tags are stored as OBJECTS with keys, not arrays.
 * Structure: tags: { "Sexual Content": 100, "Nudity": 50, ... }
 * 
 * @returns {Object} - MongoDB $nor condition for kid safety
 */
function getKidSafetyFilter() {
  // Comprehensive list of inappropriate tags/categories
  const badTags = [
    // Explicit adult content
    "Sexual Content", "Nudity", "Mature", "Adult", "NSFW", 
    "Hentai", "Porn", "Erotic", "XXX", "Ecchi", "Loli",
    "Dating Sim", "Romance", "Anime",
    
    // Violence
    "Violent", "Gore", "Blood", "Brutal",
    
    // Visual Novel (often contains adult content)
    "Visual Novel",
  ];

  // Build $nor conditions array
  const norConditions = [];

  // ========== CATEGORIES (array of strings) ==========
  norConditions.push({ categories: { $in: badTags } });

  // ========== GENRES (array of strings) ==========
  norConditions.push({ genres: { $in: badTags } });

  // ========== TAGS (OBJECT with keys) - THE CRITICAL FIX ==========
  // Check if any bad tag exists as a KEY in the tags object
  // Example: tags: { "Nudity": 100, "Sexual Content": 50 }
  badTags.forEach(tag => {
    norConditions.push({ [`tags.${tag}`]: { $exists: true } });
  });

  // ========== STEAMSPY_TAGS (can be string or array) ==========
  const rxBadTags = new RegExp(
    badTags.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );
  norConditions.push({ steamspy_tags: { $in: badTags } });
  norConditions.push({ steamspy_tags: rxBadTags });

  // ========== GAME TITLE ==========
  const badTitleWords = [
    "Hentai", "Porn", "Sex", "Nude", "Nudity", "Erotic", 
    "XXX", "NSFW", "Loli", "Ecchi", "Waifu", "Gore",
    "Violent",
    // Specific problematic game names
    "Funbag", "Meltys", "NEKOMIMI", "Unlock Me",
    "Deep Space Waifu", "Tower of Five Hearts", 
    "K Station", "Kara no Shojo"
  ];
  const rxBadName = new RegExp(
    badTitleWords.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );
  norConditions.push({ name: rxBadName });

  // ========== DEVELOPERS ==========
  const badDevTerms = [
    "NSFW", "Hentai", "Adult", "Erotic", 
    "Waffle", "MangaGamer", "TsukiWare", 
    "Remtairy", "Kagura Games", "Neko Climax",
    "Maya Games", "Perpetual FX Creative"
  ];
  const rxBadDev = new RegExp(
    badDevTerms.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );
  norConditions.push({ developers: { $in: badDevTerms } });
  norConditions.push({ developers: rxBadDev });

  // ========== PUBLISHERS ==========
  const badPubTerms = [
    "MangaGamer", "Kagura Games", "Maya Games", 
    "Remtairy", "Neko Climax"
  ];
  const rxBadPub = new RegExp(
    badPubTerms.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );
  norConditions.push({ publishers: { $in: badPubTerms } });
  norConditions.push({ publishers: rxBadPub });

  // ========== AGE RATING ==========
  norConditions.push({ required_age: { $gte: 18 } });

  return { $nor: norConditions };
}

/* -------------------------------------------------------------------------- */
/* Helper: Extract characteristics from favorite games for recommendations    */
/* -------------------------------------------------------------------------- */

/**
 * Analyzes favorite games to extract common characteristics.
 * Used to build personalized recommendations based on user preferences.
 * FOR KID PROFILE: Only extracts characteristics from kid-safe favorites.
 * 
 * @param {Array<string>} appids - Array of Steam app IDs from favorites
 * @param {string} profile - Profile ID (kid, person1, person2)
 * @returns {Object|null} - Characteristics object or null if no data
 */
async function getFavoriteCharacteristics(appids, profile = "person1") {
  if (!Array.isArray(appids) || appids.length === 0) return null;

  // Build query with kid safety filter if needed
  const query = { appid: { $in: appids.map(String) } };
  
  // CRITICAL: If kid profile, only analyze kid-safe favorites
  if (String(profile) === "kid") {
    Object.assign(query, getKidSafetyFilter());
  }

  // Fetch favorite games with relevant fields only
  const favorites = await Game.find(query)
    .select("genres supported_languages developers categories price")
    .lean();

  if (favorites.length === 0) return null;

  // Initialize aggregation maps
  const genresMap = {};
  const languagesMap = {};
  const developersMap = {};
  const categoriesMap = {};
  const prices = [];

  // Aggregate characteristics from all favorite games
  favorites.forEach(game => {
    // Count genre occurrences
    if (Array.isArray(game.genres)) {
      game.genres.forEach(g => {
        genresMap[g] = (genresMap[g] || 0) + 1;
      });
    }

    // Count language occurrences
    if (Array.isArray(game.supported_languages)) {
      game.supported_languages.forEach(l => {
        languagesMap[l] = (languagesMap[l] || 0) + 1;
      });
    }

    // Count developer occurrences
    if (Array.isArray(game.developers)) {
      game.developers.forEach(d => {
        developersMap[d] = (developersMap[d] || 0) + 1;
      });
    }

    // Count category occurrences
    if (Array.isArray(game.categories)) {
      game.categories.forEach(c => {
        categoriesMap[c] = (categoriesMap[c] || 0) + 1;
      });
    }

    // Collect prices for range analysis
    if (game.price != null) {
      prices.push(Number(game.price));
    }
  });

  // Extract top 5 most frequent genres
  const topGenres = Object.entries(genresMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre);

  // Extract top 3 most frequent languages
  const topLanguages = Object.entries(languagesMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang]) => lang);

  // Extract top 3 most frequent developers
  const topDevelopers = Object.entries(developersMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dev]) => dev);

  // Extract top 3 most frequent categories
  const topCategories = Object.entries(categoriesMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // Calculate average price from favorites
  const avgPrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : null;

  // Calculate price range bounds
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

  return {
    topGenres,
    topLanguages,
    topDevelopers,
    topCategories,
    avgPrice,
    minPrice,
    maxPrice,
  };
}

/* -------------------------------------------------------------------------- */
/* Utils: Build MongoDB $match object from filters                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds a MongoDB $match object for aggregation pipelines.
 * Applies all user-selected filters including kid profile safety exclusions.
 * 
 * @param {Object} f - Filter object from frontend
 * @returns {Object} - MongoDB $match condition
 */
function buildMatch(f = {}) {
  const and = [];

  // Text search across name, developers, and genres (diacritic-insensitive)
  if (f.search && String(f.search).trim()) {
    const pattern = toDiacriticRegex(String(f.search).trim());
    const rx = new RegExp(pattern, "i");
    and.push({ $or: [{ name: rx }, { developers: rx }, { genres: rx }] });
  }

  // Quick category filters
  switch (f.category) {
    case "favorites":
      // Only apply if no appids provided (legacy support)
      if (!(Array.isArray(f.appids) && f.appids.length)) {
        and.push({ favorite: true });
      }
      break;
    case "best":
      // High-rated games (user score >= 80)
      and.push({ user_score: { $gte: 80 } });
      break;
    case "recommendations":
      // Handled separately with scoring logic
      break;
    // NOTE: "goty" category is filtered AFTER the $lookup stage
    default:
      break;
  }

  // Platform filters (Windows, Mac, Linux) - OR logic
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac || f.mac === "1") ors.push({ mac: true });
  if (f.platforms?.linux || f.linux === "1") ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  // Genre filter (must be present in genres array)
  if (f.genre) and.push({ genres: f.genre });

  // Language filter (must be present in supported_languages array)
  if (f.language) and.push({ supported_languages: f.language });

  // Favorites by appids (frontend sends array of favorite game IDs)
  if (Array.isArray(f.appids) && f.appids.length) {
    const ids = f.appids.map(v => String(v));
    and.push({ appid: { $in: ids } });
  }

  // Multiplayer mode filters
  if (f.multiplayer === "single") and.push({ categories: "Single-player" });
  if (f.multiplayer === "multi") and.push({ categories: "Multi-player" });

  // Developer filter (exact match or diacritic-insensitive regex)
  if (f.developer) {
    const dev = String(f.developer).trim();
    const devPattern = new RegExp(toDiacriticRegex(dev), "i");
    and.push({ $or: [{ developers: dev }, { developers: devPattern }] });
  }

  // Price range filter (always bounded, defaults: 0 - 999999)
  const min = f.priceMin != null ? Number(f.priceMin) : 0;
  const max = f.priceMax != null ? Number(f.priceMax) : 999999;
  and.push({ price: { $gte: min, $lte: max } });

  /* ------------------------ KID PROFILE SAFETY FILTER --------------------- */
  /**
   * When profile is "kid", exclude games with inappropriate content.
   */
  if (String(f.profile) === "kid") {
    and.push(getKidSafetyFilter());
  }
  /* ----------------------------------------------------------------------- */

  // Return combined match condition
  if (and.length === 0) return {};
  return and.length === 1 ? and[0] : { $and: and };
}

/* -------------------------------------------------------------------------- */
/* Build recommendation match - BALANCED VERSION                              */
/* -------------------------------------------------------------------------- */
/*
 * Builds recommendation match - GENRE-FOCUSED VERSION
 * REQUIRES at least one genre match for recommendations
 */
async function buildRecommendationMatch(f = {}) {
  const and = [];

  const favAppids = Array.isArray(f.appids) && f.appids.length ? f.appids : [];
  const profile = String(f.profile || "person1");
  
  if (favAppids.length === 0) {
    return null;
  }

  // CRITICAL: Apply kid safety filter FIRST
  if (profile === "kid") {
    and.push(getKidSafetyFilter());
  }

  // Extract characteristics (kid-safe only for kid profile)
  const characteristics = await getFavoriteCharacteristics(favAppids, profile);
  
  if (!characteristics) {
    if (profile === "kid") {
      return { $and: and };
    }
    return null;
  }

  // Exclude already favorited games
  and.push({ appid: { $nin: favAppids.map(String) } });

  // CRITICAL FIX: Require AT LEAST ONE GENRE MATCH
  // This ensures recommendations are actually similar
  if (characteristics.topGenres.length > 0) {
    and.push({ genres: { $in: characteristics.topGenres } });
  } else {
    // If no genres found, fall back to category matching
    if (characteristics.topCategories.length > 0) {
      and.push({ categories: { $in: characteristics.topCategories } });
    }
  }

  // Platform filters
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac || f.mac === "1") ors.push({ mac: true });
  if (f.platforms?.linux || f.linux === "1") ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  if (and.length === 0) return {};
  return { $and: and };
}

/* -------------------------------------------------------------------------- */
/* Build scoring pipeline - BALANCED VERSION                                  */
/* -------------------------------------------------------------------------- */

/**
 * Creates MongoDB aggregation stages to score games by similarity.
 * BALANCED: High weights for genres but doesn't eliminate games without genre match.
 * 
 * Scoring factors:
 * - Genre match: 100 points per match (HIGHEST PRIORITY)
 * - Category match: 30 points per match
 * - Developer match: 20 points per match
 * - Language match: 10 points per match
 * - Price similarity: 0-10 points
 * - User rating bonus: 0-5 points
 * 
 * @param {Array<string>} favAppids - Favorite game IDs
 * @param {Object} characteristics - Extracted characteristics object
 * @returns {Array} - MongoDB aggregation stages
 */
async function buildRecommendationScoring(favAppids, characteristics) {
  if (!characteristics) return [];

  const scoreFields = {};
  
  // Score by genre overlap (count matching genres) - HIGHEST PRIORITY
  if (characteristics.topGenres.length > 0) {
    scoreFields.genreScore = {
      $size: {
        $ifNull: [
          {
            $setIntersection: [
              { $ifNull: ["$genres", []] },
              characteristics.topGenres
            ]
          },
          []
        ]
      }
    };
  }

  // Score by category overlap
  if (characteristics.topCategories.length > 0) {
    scoreFields.catScore = {
      $size: {
        $ifNull: [
          {
            $setIntersection: [
              { $ifNull: ["$categories", []] },
              characteristics.topCategories
            ]
          },
          []
        ]
      }
    };
  }

  // Score by developer overlap
  if (characteristics.topDevelopers.length > 0) {
    scoreFields.devScore = {
      $size: {
        $ifNull: [
          {
            $setIntersection: [
              { $ifNull: ["$developers", []] },
              characteristics.topDevelopers
            ]
          },
          []
        ]
      }
    };
  }

  // Score by language overlap
  if (characteristics.topLanguages.length > 0) {
    scoreFields.langScore = {
      $size: {
        $ifNull: [
          {
            $setIntersection: [
              { $ifNull: ["$supported_languages", []] },
              characteristics.topLanguages
            ]
          },
          []
        ]
      }
    };
  }

  // Score by price similarity (0-10 points)
  if (characteristics.avgPrice != null) {
    scoreFields.priceScore = {
      $cond: {
        if: { $and: [
          { $gte: ["$price", 0] },
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
                    { $add: [characteristics.avgPrice, 1] }
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

  // Calculate weighted total recommendation score
  scoreFields.recommendationScore = {
    $add: [
      // Genre is CRITICAL - 100 points per match
      { $multiply: [{ $ifNull: ["$genreScore", 0] }, 100] },
      
      // Categories - 30 points per match
      { $multiply: [{ $ifNull: ["$catScore", 0] }, 30] },
      
      // Developer - 20 points per match
      { $multiply: [{ $ifNull: ["$devScore", 0] }, 20] },
      
      // Language - 10 points per match
      { $multiply: [{ $ifNull: ["$langScore", 0] }, 10] },
      
      // Price similarity - 0 to 10 points
      { $ifNull: ["$priceScore", 0] },
      
      // User rating bonus - 0 to 5 points
      { $divide: [{ $ifNull: ["$user_score", 0] }, 20] },
    ]
  };

  return [
    { $addFields: scoreFields }
  ];
}

/* -------------------------------------------------------------------------- */
/* Utils: Build $sort object                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds a MongoDB $sort object based on sort key.
 * For recommendations, sorts by recommendation score first.
 * 
 * @param {string} sortKey - Sort key (e.g., "name-asc", "price-desc")
 * @param {boolean} isRecommendation - Whether this is a recommendation query
 * @returns {Object} - MongoDB $sort object
 */
function buildSort(sortKey = "name-asc", isRecommendation = false) {
  if (isRecommendation) {
    // For recommendations: sort by score (desc), then rating, then name
    return { recommendationScore: -1, user_score: -1, name: 1 };
  }
  
  // Standard sort options
  return {
    "name-asc": { name: 1 },
    "name-desc": { name: -1 },
    "price-asc": { price: 1 },
    "price-desc": { price: -1 },
    "date-desc": { release_date_parsed: -1 },
    "date-asc": { release_date_parsed: 1 },
    "rating-desc": { user_score: -1 },
  }[sortKey] || { name: 1 };
}

/* -------------------------------------------------------------------------- */
/* Utils: Build projection list for returned fields                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds a MongoDB projection object to control which fields are returned.
 * 
 * @param {Object} reqProjection - Custom projection from request
 * @returns {Object} - MongoDB projection object
 */
function buildProjectList(reqProjection) {
  if (reqProjection && typeof reqProjection === "object") return reqProjection;
  // Default: return minimal fields
  return { name: 1, header_image: 1, genres: 1, price: 1 };
}

/* -------------------------------------------------------------------------- */
/* Helper: GOTY per-profile join stages                                       */
/* -------------------------------------------------------------------------- */

/**
 * Creates aggregation stages to join GOTY (Game of the Year) data.
 * Attaches "goty_year" field to games that are marked as GOTY for the profile.
 * 
 * @param {string} profile - Profile ID (kid, person1, person2)
 * @returns {Array} - MongoDB aggregation stages
 */
function gotyJoinStages(profile = "person1") {
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
    { $project: { gotyP: 0 } }, // Remove temporary join field
  ];
}

/* -------------------------------------------------------------------------- */
/* Main pipeline builder: Combines all filters, scoring, and pagination       */
/* -------------------------------------------------------------------------- */

/**
 * Builds the complete MongoDB aggregation pipeline for game search.
 * Handles regular searches, favorites, recommendations, and GOTY filtering.
 * Uses $facet to return both items and total count in one query.
 * 
 * @param {Object} options - Pipeline options
 * @param {Object} options.filters - Filter object from frontend
 * @param {string} options.sort - Sort key
 * @param {number} options.page - Current page number
 * @param {number} options.limit - Items per page
 * @param {Object} options.projection - Field projection
 * @returns {Array} - Complete MongoDB aggregation pipeline
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
    // Build recommendation-specific pipeline
    const favAppids = Array.isArray(filters.appids) && filters.appids.length ? filters.appids : [];
    characteristics = favAppids.length > 0 ? await getFavoriteCharacteristics(favAppids, profile) : null;
    $match = await buildRecommendationMatch(filters);
    
    if (!$match) {
      // No favorites or characteristics - return empty pipeline
      return [
        { $match: { _id: null } }, // Match nothing
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

    // Add scoring stages for recommendations
    scoringStages = await buildRecommendationScoring(filters.appids, characteristics);
  } else {
    // Standard search pipeline
    $match = buildMatch(filters);
  }

  const $sort = buildSort(sort, isRecommendation);
  const $project = buildProjectList(projection);

  // Base pipeline stages
  const base = [
    {
      // Parse release_date string to Date object for sorting
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

  // Post-match filters for GOTY category (applied after join)
  const postMatch = [];
  if (filters.category === "goty") {
    if (filters.gotyYear) {
      // Filter by specific GOTY year
      postMatch.push({ $match: { goty_year: Number(filters.gotyYear) } });
    } else {
      // Show all GOTY games
      postMatch.push({ $match: { goty_year: { $ne: null } } });
    }
  }

  // Return complete pipeline with $facet for items + total count
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
 * Main search API endpoint.
 * Handles all game queries: search, filters, favorites, recommendations, GOTY.
 * Returns paginated results with total count.
 */
router.post("/search", async (req, res) => {
  try {
    const {
      filters = {},
      sort,
      page = 1,
      limit = 40,
      projection,
      withTotal = page === 1, // Only count total on first page
    } = req.body || {};

    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const profile = String(filters.profile || "person1");
    const isRecommendation = filters.category === "recommendations";

    // Build pipeline (with or without $count based on withTotal flag)
    const pipeline = withTotal
      ? await buildSearchPipeline({ filters, sort, page, limit, projection })
      : await (async () => {
          // Lightweight pipeline without $count for subsequent pages
          let $match;
          let scoringStages = [];
          let characteristics = null;

          if (isRecommendation) {
            const favAppids = Array.isArray(filters.appids) && filters.appids.length ? filters.appids : [];
            characteristics = favAppids.length > 0 ? await getFavoriteCharacteristics(favAppids, profile) : null;
            $match = await buildRecommendationMatch(filters);
            
            if (!$match) {
              return [{ $match: { _id: null } }];
            }

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
            ...(() => {
              return Object.keys($match).length ? [{ $match }] : [];
            })(),
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

    // Execute aggregation with disk use allowed for large datasets
    let agg = Game.aggregate(pipeline).allowDiskUse(true);

    // Apply locale collation for text searches (case/accent insensitive)
    if (
      (filters && String(filters.search || "").trim()) ||
      (filters && String(filters.developer || "").trim())
    ) {
      agg = agg.collation({ locale: "es", strength: 1, caseLevel: false });
    }

    const out = await agg;

    let items = [];
    let total = null;

    if (withTotal) {
      // Extract items and total from $facet result
      const bucket = out[0] || {};
      items = bucket.items || [];
      total = typeof bucket.total === "number" ? bucket.total : 0;
    } else {
      // No total count - just items
      items = out || [];
    }

    // Determine if there are more pages
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
/* DISTINCT endpoints - Get unique values for filters                         */
/* -------------------------------------------------------------------------- */

/**
 * Builds an aggregation pipeline to get distinct values for a field.
 * Applies current filters to show only relevant options.
 * 
 * @param {string} field - Field name (genres, supported_languages, developers)
 * @param {Object} filters - Current filter state
 * @returns {Array} - MongoDB aggregation pipeline
 */
function buildDistinctPipeline(field, filters = {}) {
  const $match = buildMatch(filters);
  return [
    Object.keys($match).length ? { $match } : null,
    { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: { $trim: { input: { $toString: `$${field}` } } },
      },
    },
    { $match: { _id: { $ne: "" } } }, // Remove empty strings
    { $sort: { _id: 1 } }, // Alphabetical sort
    { $project: { _id: 0, value: "$_id" } },
  ].filter(Boolean);
}

/**
 * GET /api/games/distinct/genres
 * Returns all unique game genres (filtered by current search/profile).
 */
router.get("/distinct/genres", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("genres", req.query);
    const rows = await Game.aggregate(pipeline);
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct genres error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * GET /api/games/distinct/languages
 * Returns all unique supported languages (filtered by current search/profile).
 */
router.get("/distinct/languages", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("supported_languages", req.query);
    const rows = await Game.aggregate(pipeline);
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct languages error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * GET /api/games/distinct/developers
 * Returns all unique game developers (filtered by current search/profile).
 */
router.get("/distinct/developers", async (req, res) => {
  try {
    const pipeline = buildDistinctPipeline("developers", req.query);
    const rows = await Game.aggregate(pipeline);
    res.json({ ok: true, items: rows.map(r => r.value) });
  } catch (e) {
    console.error("distinct developers error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* GET /api/games/:id - Get single game details                               */
/* -------------------------------------------------------------------------- */

/**
 * Get a single game by MongoDB _id or Steam appid.
 * Returns full game document with all fields.
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Try finding by MongoDB _id first
    if (mongoose.isValidObjectId(id)) {
      const g = await Game.findById(id).lean();
      if (g) return res.json({ ok: true, data: g });
    }

    // Try finding by Steam appid
    const g2 = await Game.findOne({ appid: String(id) }).lean();
    if (!g2) return res.status(404).json({ ok: false, error: "not_found" });

    res.json({ ok: true, data: g2 });
  } catch (e) {
    console.error("GET /api/games/:id error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* RAW AGGREGATION endpoint - For advanced queries                            */
/* -------------------------------------------------------------------------- */

/**
 * Allowed MongoDB aggregation stages for security.
 * Prevents dangerous operations like $where, $function.
 */
const ALLOWED_STAGES = new Set([
  "$match", "$project", "$sort", "$limit", "$skip",
  "$unwind", "$group", "$lookup", "$addFields", "$set",
  "$facet", "$count", "$sample", "$sortByCount",
  "$unset", "$replaceRoot", "$replaceWith",
  "$setWindowFields"
]);

/**
 * Forbidden MongoDB operators that could execute arbitrary code.
 */
const FORBIDDEN_KEYS = ["$where", "$function", "$accumulator"];

/**
 * Parses a MongoDB shell command into a pipeline array.
 * Example: "db.games.aggregate([{$match:{}}])" → [{$match:{}}]
 */
function parseCommandToPipeline(cmd) {
  const m = String(cmd).match(/aggregate\s*\(\s*(\[.*\])\s*\)/s);
  if (!m) throw new SyntaxError("bad_aggregate_syntax");
  return JSON.parse(m[1]);
}

/**
 * Validates an aggregation pipeline for security.
 * Ensures only allowed stages are used and no forbidden operators.
 */
function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline)) throw new Error("pipeline_must_be_array");

  // Recursively scan for forbidden operators
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

  // Validate each stage
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
 * Executes a custom MongoDB aggregation pipeline.
 * Used for advanced queries and analytics.
 * 
 * Security: Only allows whitelisted stages, validates input.
 */
router.post("/agg", async (req, res) => {
  try {
    const { pipeline, command, allowDiskUse = true, maxTimeMS = 5000 } = req.body || {};
    
    // Parse pipeline from JSON or shell command string
    const pipe = pipeline ? pipeline : parseCommandToPipeline(command);
    
    // Validate for security
    validatePipeline(pipe);

    // Execute with timeout and disk use
    const cursor = Game.aggregate(pipe, { allowDiskUse }).option({ maxTimeMS });
    const items = await cursor.exec();

    res.json({ ok: true, items });
  } catch (e) {
    console.error("RAW AGG error:", e);
    const msg = e instanceof SyntaxError ? "syntax_error" : e.message || "server_error";
    res.status(400).json({ ok: false, error: msg });
  }
});

export default router;
