// src/routes/games.js
import { Router } from "express";
import mongoose from "mongoose";
import Game from "../models/Game.js";
import Goty from "../models/Goty.js"; // <-- NEW

const router = Router();

/* -------------------------------------------------------------------------- */
/* utils: diacritic-insensitive regex                                         */
/* -------------------------------------------------------------------------- */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
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
/* utils: filters -> $match                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Build a $match object for aggregation according to provided filters.
 * Adds "kid" profile safety exclusions using MongoDB-only conditions.
 */
function buildMatch(f = {}) {
  const and = [];

  // Text search (name, developers, genres) with diacritic-insensitive pattern
  if (f.search && String(f.search).trim()) {
    const pattern = toDiacriticRegex(String(f.search).trim());
    const rx = new RegExp(pattern, "i");
    and.push({ $or: [{ name: rx }, { developers: rx }, { genres: rx }] });
  }

  // Quick categories (favorites is handled by appids on the frontend)
  switch (f.category) {
    case "favorites":
      if (!(Array.isArray(f.appids) && f.appids.length)) {
        and.push({ favorite: true });
      }
      break;
    case "best":
      and.push({ user_score: { $gte: 80 } });
      break;
    case "recommendations":
      and.push({ recommendations: { $gt: 0 } });
      break;
    // NOTE: for category "goty" we will filter AFTER the $lookup stage.
    default:
      break;
  }

  // Platforms (OR if any)
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac     || f.mac === "1")     ors.push({ mac: true });
  if (f.platforms?.linux   || f.linux === "1")   ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  // Genre (must be present in array)
  if (f.genre) and.push({ genres: f.genre });

  // Language (must be present in array)
  if (f.language) and.push({ supported_languages: f.language });

  // FAVORITES by appids (frontend sends appids array)
  if (Array.isArray(f.appids) && f.appids.length) {
    const ids = f.appids.map(v => String(v));
    and.push({ appid: { $in: ids } });
  }

  // Single / Multi via categories array
  if (f.multiplayer === "single") and.push({ categories: "Single-player" });
  if (f.multiplayer === "multi")  and.push({ categories: "Multi-player" });

  // Developer (exact or regex, diacritic-insensitive)
  if (f.developer) {
    const dev = String(f.developer).trim();
    const devPattern = new RegExp(toDiacriticRegex(dev), "i");
    and.push({ $or: [{ developers: dev }, { developers: devPattern }] });
  }

  // Price range (always bounded)
  const min = f.priceMin != null ? Number(f.priceMin) : 0;
  const max = f.priceMax != null ? Number(f.priceMax) : 999999;
  and.push({ price: { $gte: min, $lte: max } });

  /* ------------------------ KID profile safety filter --------------------- */
if (String(f.profile) === "kid") {
  // Categories/tags to exclude
  const badTags = ["Violent", "Sexual Content", "Nudity", "Gore", "Hentai", "Loli", "Porn", "Erotic", "XXX"];

  // Title words to exclude
  const badWords = ["Hentai", "Porn", "Sex", "Nude", "Erotic", "XXX", "NSFW", "Loli", "Nudity", "Gore", "Violent"];
  const rxBadName = new RegExp(
    badWords.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );

  // Tags can come as array or string
  const rxBadTags = new RegExp(
    badTags.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );

  // NEW: developer words to exclude
  const badDevTerms = ["NSFW", "Hentai"];
  const rxBadDev = new RegExp(
    badDevTerms.map(w => toDiacriticRegex(w)).join("|"),
    "i"
  );

  and.push({
    $nor: [
      // tags/genres/categories
      { categories:    { $elemMatch: { $in: badTags } } },
      { genres:        { $elemMatch: { $in: badTags } } },
      { tags:          { $elemMatch: { $in: badTags } } },          // array
      { steamspy_tags: { $elemMatch: { $in: badTags } } },          // array
      { steamspy_tags: rxBadTags },                                 // string

      // title
      { name: rxBadName },

      // NEW: developers (supports array or string)
      { developers: { $elemMatch: { $regex: rxBadDev } } },         // array of devs
      { developers:   rxBadDev },                                   // single string field
    ],
  });
}
/* ----------------------------------------------------------------------- */

  if (and.length === 0) return {};
  return and.length === 1 ? and[0] : { $and: and };
}

/* -------------------------------------------------------------------------- */
/* utils: sort -> $sort                                                       */
/* -------------------------------------------------------------------------- */
function buildSort(sortKey = "name-asc") {
  return {
    "name-asc":    { name: 1 },
    "name-desc":   { name: -1 },
    "price-asc":   { price: 1 },
    "price-desc":  { price: -1 },
    "date-desc":   { release_date_parsed: -1 },
    "date-asc":    { release_date_parsed: 1 },
    "rating-desc": { user_score: -1 },
  }[sortKey] || { name: 1 };
}

/* -------------------------------------------------------------------------- */
/* utils: projection list                                                     */
/* -------------------------------------------------------------------------- */
function buildProjectList(reqProjection) {
  if (reqProjection && typeof reqProjection === "object") return reqProjection;
  return { name: 1, header_image: 1, genres: 1, price: 1 };
}

/* -------------------------------------------------------------------------- */
/* helpers: GOTY per-profile join                                             */
/* -------------------------------------------------------------------------- */
/**
 * Lookup GOTY for the current profile and attach "goty_year" to the game.
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
    { $project: { gotyP: 0 } },
  ];
}

/* -------------------------------------------------------------------------- */
/* Main pipeline: $facet items + total                                        */
/* -------------------------------------------------------------------------- */
function buildSearchPipeline({
  filters = {},
  sort = "name-asc",
  page = 1,
  limit = 40,
  projection,
} = {}) {
  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const $match = buildMatch(filters);
  const $sort  = buildSort(sort);
  const $project = buildProjectList(projection);
  const profile = String(filters.profile || "person1");

  // Base pipeline
  const base = [
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
    ...gotyJoinStages(profile), // <-- attach goty_year per profile
  ].filter(Boolean);

  // If category is "goty", filter by join result (and optional year)
  const postMatch = [];
  if (filters.category === "goty") {
    if (filters.gotyYear) {
      postMatch.push({ $match: { goty_year: Number(filters.gotyYear) } });
    } else {
      postMatch.push({ $match: { goty_year: { $ne: null } } });
    }
  }

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
/* POST /api/games/search                                                     */
/* -------------------------------------------------------------------------- */
router.post("/search", async (req, res) => {
  try {
    const {
      filters = {},
      sort,
      page = 1,
      limit = 40,
      projection,
      withTotal = page === 1,
    } = req.body || {};

    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const profile = String(filters.profile || "person1");

    // Lightweight pipeline (no $count) when withTotal=false
    const pipeline = withTotal
      ? buildSearchPipeline({ filters, sort, page, limit, projection })
      : [
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
            const $match = buildMatch(filters);
            return Object.keys($match).length ? [{ $match }] : [];
          })(),
          ...gotyJoinStages(profile), // <-- keep goty_year in lightweight pipeline too
          // Same post-filter for "goty" category
          ...(() => {
            if (filters.category !== "goty") return [];
            if (filters.gotyYear) return [{ $match: { goty_year: Number(filters.gotyYear) } }];
            return [{ $match: { goty_year: { $ne: null } } }];
          })(),
          { $sort: buildSort(sort) },
          { $skip: skip },
          { $limit: Math.max(1, Number(limit)) },
          { $project: buildProjectList(projection) },
        ];

    let agg = Game.aggregate(pipeline).allowDiskUse(true);

    // Use locale collation when text filters exist (ignores case/accents)
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
      const bucket = out[0] || {};
      items = bucket.items || [];
      total = typeof bucket.total === "number" ? bucket.total : 0;
    } else {
      items = out || [];
    }

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
/* DISTINCT endpoints (genres / languages / developers)                       */
/* -------------------------------------------------------------------------- */
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
    { $match: { _id: { $ne: "" } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, value: "$_id" } },
  ].filter(Boolean);
}

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
/* GET /api/games/:id  (by _id or appid)                                      */
/* -------------------------------------------------------------------------- */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (mongoose.isValidObjectId(id)) {
      const g = await Game.findById(id).lean();
      if (g) return res.json({ ok: true, data: g });
    }
    const g2 = await Game.findOne({ appid: String(id) }).lean();
    if (!g2) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, data: g2 });
  } catch (e) {
    console.error("GET /api/games/:id error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* RAW AGG endpoint                                                           */
/* -------------------------------------------------------------------------- */
const ALLOWED_STAGES = new Set([
  "$match", "$project", "$sort", "$limit", "$skip",
  "$unwind", "$group", "$lookup", "$addFields", "$set",
  "$facet", "$count", "$sample", "$sortByCount",
  "$unset", "$replaceRoot", "$replaceWith",
  "$setWindowFields"
]);
const FORBIDDEN_KEYS = ["$where", "$function", "$accumulator"];

function parseCommandToPipeline(cmd) {
  const m = String(cmd).match(/aggregate\s*\(\s*(\[.*\])\s*\)/s);
  if (!m) throw new SyntaxError("bad_aggregate_syntax");
  return JSON.parse(m[1]);
}
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

router.post("/agg", async (req, res) => {
  try {
    const { pipeline, command, allowDiskUse = true, maxTimeMS = 5000 } = req.body || {};
    const pipe = pipeline ? pipeline : parseCommandToPipeline(command);
    validatePipeline(pipe);

    const cursor = Game.aggregate(pipe, { allowDiskUse }).option({ maxTimeMS });
    const items = await cursor.exec();
    res.json({ ok: true, items });
  } catch (e) {
    console.error("RAW AGG error:", e);
    const msg = e instanceof SyntaxError ? "syntax_error" : e.message || "server_error";
    res.status(400).json({ ok: false, error: msg });
  }
});

/* -------------------------------------------------------------------------- */
/* GOTY endpoints: per-profile set / unset                                    */
/* -------------------------------------------------------------------------- */
/**
 * POST /api/games/goty/set
 * Body: { appid: "20200", year: 2008, profile: "kid" | "person1" | "person2" }
 * Guarantees: only one GOTY per (profile, year).
 */
router.post("/goty/set", async (req, res) => {
  try {
    const { appid, year, profile = "person1" } = req.body || {};
    const y = Number(year);
    const p = String(profile);
    if (!appid || !y || !Number.isFinite(y) || !["kid","person1","person2"].includes(p)) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }

    // 1) Remove any previous GOTY for (profile, year)
    await Goty.deleteOne({ profile: p, year: y });

    // 2) Set new
    await Goty.create({ profile: p, year: y, appid: String(appid) });

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/games/goty/set error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * POST /api/games/goty/unset
 * Body: { year: 2008, profile }  OR  { appid: "20200", profile }
 * Removes GOTY status for that profile.
 */
router.post("/goty/unset", async (req, res) => {
  try {
    const { year, appid, profile = "person1" } = req.body || {};
    const p = String(profile);
    if (!["kid","person1","person2"].includes(p)) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }
    const q = year != null
      ? { profile: p, year: Number(year) }
      : appid
        ? { profile: p, appid: String(appid) }
        : null;

    if (!q) return res.status(400).json({ ok: false, error: "bad_request" });

    const r = await Goty.deleteMany(q);
    res.json({ ok: true, modified: r.deletedCount || 0 });
  } catch (e) {
    console.error("POST /api/games/goty/unset error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/games/recommendations                                            */
/* Body: { appid: "STRING", page?, limit?, filters?, projection? }            */
/* Renvoie: { ok, page, limit, total, hasMore, items }                        */
/* -------------------------------------------------------------------------- */
router.post("/recommendations", async (req, res) => {
  try {
    const {
      appid,
      page = 1,
      limit = 20,
      filters = {},
      projection,
    } = req.body || {};

    if (!appid) return res.status(400).json({ ok: false, error: "missing_appid" });

    const $matchBase = buildMatch(filters);
    const $project   = buildProjectList(projection);
    const skip       = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));

    const pipeline = [
      /* 1) Jeu seed */
      { $match: { appid: String(appid) } },
      {
        $project: {
          _id: 0,
          seed_appid: "$appid",
          seed_genres: { $ifNull: ["$genres", []] },
          seed_categories: { $ifNull: ["$categories", []] },
          seed_developers: { $ifNull: ["$developers", []] },
          seed_publishers: { $ifNull: ["$publishers", []] },
          seed_languages: { $ifNull: ["$supported_languages", []] },
          seed_os: [
            { $cond: ["$windows", "windows", null] },
            { $cond: ["$mac", "mac", null] },
            { $cond: ["$linux", "linux", null] },
          ],
          seed_tags: {
            $ifNull: [
              { $map: { input: { $objectToArray: { $ifNull: ["$tags", {}] } }, in: "$$this.k" } },
              []
            ]
          },
        }
      },
      /* 2) Cross-join contrôlé vers candidats filtrés par tes règles */
      {
        $lookup: {
          from: "games",
          let: {
            seed_appid: "$seed_appid",
            seed_genres: "$seed_genres",
            seed_categories: "$seed_categories",
            seed_developers: "$seed_developers",
            seed_publishers: "$seed_publishers",
            seed_languages: "$seed_languages",
            seed_os: "$seed_os",
            seed_tags: "$seed_tags",
          },
          pipeline: [
            { $match: { ...$matchBase } },
            { $match: { $expr: { $ne: ["$appid", "$$seed_appid"] } } },
            {
              $addFields: {
                _genres: { $ifNull: ["$genres", []] },
                _categories: { $ifNull: ["$categories", []] },
                _developers: { $ifNull: ["$developers", []] },
                _publishers: { $ifNull: ["$publishers", []] },
                _languages: { $ifNull: ["$supported_languages", []] },
                _os: [
                  { $cond: ["$windows", "windows", null] },
                  { $cond: ["$mac", "mac", null] },
                  { $cond: ["$linux", "linux", null] },
                ],
                _tags: {
                  $ifNull: [
                    { $map: { input: { $objectToArray: { $ifNull: ["$tags", {}] } }, in: "$$this.k" } },
                    []
                  ]
                },
                _pos: { $ifNull: ["$positive", 0] },
                _neg: { $ifNull: ["$negative", 0] },
              }
            },
            /* Similarité + boosts */
            {
              $addFields: {
                sim_genres: { $size: { $setIntersection: ["$_genres", "$$seed_genres"] } },
                sim_categories: { $size: { $setIntersection: ["$_categories", "$$seed_categories"] } },
                sim_devs: { $size: { $setIntersection: ["$_developers", "$$seed_developers"] } },
                sim_pubs: { $size: { $setIntersection: ["$_publishers", "$$seed_publishers"] } },
                sim_lang: { $size: { $setIntersection: ["$_languages", "$$seed_languages"] } },
                sim_os: { $size: { $setIntersection: ["$_os", "$$seed_os"] } },
                sim_tags: { $size: { $setIntersection: ["$_tags", "$$seed_tags"] } },
                rating: {
                  $cond: [
                    { $gt: [{ $add: ["$_pos", "$_neg"] }, 0] },
                    { $divide: ["$_pos", { $add: ["$_pos", "$_neg"] }] },
                    0
                  ]
                },
                popBoost: { $divide: [{ $log10: { $add: [1, { $add: ["$_pos", "$_neg"] }] } }, 5] }
              }
            },
            {
              $addFields: {
                similarity_score: {
                  $add: [
                    { $multiply: ["$sim_genres", 3] },
                    { $multiply: ["$sim_tags", 2.5] },
                    { $multiply: ["$sim_categories", 1.5] },
                    { $multiply: ["$sim_devs", 1.2] },
                    { $multiply: ["$sim_pubs", 0.8] },
                    { $multiply: ["$sim_os", 0.6] },
                    { $multiply: ["$sim_lang", 0.4] },
                    { $multiply: ["$rating", 2] },
                    "$popBoost"
                  ]
                }
              }
            },
            { $sort: { similarity_score: -1, user_score: -1, recommendations: -1, name: 1 } },
          ],
          as: "candidates"
        }
      },
      { $unwind: "$candidates" },
      { $replaceRoot: { newRoot: "$candidates" } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: Math.max(1, Number(limit)) }, { $project: $project }],
          totalCount: [{ $count: "n" }]
        }
      },
      {
        $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.n", 0] }, 0] }
        }
      }
    ];

    let agg = Game.aggregate(pipeline);

    // Conserve ta collation pour search/dev
    if (
      (filters && String(filters.search || "").trim()) ||
      (filters && String(filters.developer || "").trim())
    ) {
      agg = agg.collation({ locale: "es", strength: 1, caseLevel: false });
    }

    const out   = await agg;
    const node  = out[0] || {};
    const items = node.items || [];
    const total = node.total || 0;
    const hasMore = (skip + items.length) < total;

    res.json({ ok: true, page: Number(page), limit: Number(limit), total, hasMore, items });
  } catch (e) {
    console.error("POST /api/games/recommendations error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});



export default router;
