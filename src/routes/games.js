// src/routes/games.js
import { Router } from "express";
import mongoose from "mongoose";
import Game from "../models/Game.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* utils: filtres -> $match                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Construit un objet $match pour l’agrégation selon les filtres fournis.
 *
 * ÉQUIVALENT "commande Mongo" (exemples):
 *  - Recherche texte (name/dev/genres):
 *      db.games.find({ $or: [ {name:/q/i}, {developers:/q/i}, {genres:/q/i} ] })
 *
 *  - Catégorie "best" (score >= 80):
 *      db.games.find({ user_score: { $gte: 80 } })
 *
 *  - Plateformes (OR):
 *      db.games.find({ $or: [ {windows:true}, {mac:true}, {linux:true} ] })
 *
 *  - Genre (présent dans array):
 *      db.games.find({ genres: "Action" })
 *
 *  - Langue (présente dans array):
 *      db.games.find({ supported_languages: "English" })
 *
 *  - Multi/Solo via categories:
 *      db.games.find({ categories: "Multi-player" })
 *      db.games.find({ categories: "Single-player" })
 *
 *  - Développeur:
 *      db.games.find({ $or: [{developers:"Valve"}, {developers:/Valve/i}] })
 *
 *  - Prix min/max:
 *      db.games.find({ price: { $gte: 0, $lte: 50 } })
 *
 *  - GOTY (année exacte ou simple présence):
 *      db.games.find({ goty_year: 2020 })
 *      db.games.find({ goty_year: { $exists: true } })
 */
function buildMatch(f = {}) {
  const and = [];

  // Texte (name, developers, genres)
  if (f.search && String(f.search).trim()) {
    const rx = new RegExp(String(f.search).trim(), "i");
    and.push({ $or: [{ name: rx }, { developers: rx }, { genres: rx }] });
  }

  // Catégories “rapides”
  switch (f.category) {
    case "favorites":
      and.push({ favorite: true });
      break;
    case "best":
      and.push({ user_score: { $gte: 80 } });
      break;
    case "recommendations":
      and.push({ recommendations: { $gt: 0 } });
      break;
    case "goty":
      if (f.gotyYear) and.push({ goty_year: Number(f.gotyYear) });
      else and.push({ goty_year: { $exists: true } });
      break;
    default:
      // "all" | undefined → rien
      break;
  }

  // Plateformes (au moins une cochée -> OR)
  const ors = [];
  if (f.platforms?.windows || f.windows === "1") ors.push({ windows: true });
  if (f.platforms?.mac     || f.mac === "1")     ors.push({ mac: true });
  if (f.platforms?.linux   || f.linux === "1")   ors.push({ linux: true });
  if (ors.length) and.push({ $or: ors });

  // Genre (présence dans array)
  if (f.genre) and.push({ genres: f.genre });

  // Langue (présence dans array)
  if (f.language) and.push({ supported_languages: f.language });

  // Multi/Solo (présence dans array categories)
  if (f.multiplayer === "single") and.push({ categories: "Single-player" });
  if (f.multiplayer === "multi")  and.push({ categories: "Multi-player" });

  // Développeur
  if (f.developer) {
    const dev = String(f.developer).trim();
    and.push({ $or: [{ developers: dev }, { developers: new RegExp(dev, "i") }] });
  }

  // Prix min/max (toujours borné)
  const min = f.priceMin != null ? Number(f.priceMin) : 0;
  const max = f.priceMax != null ? Number(f.priceMax) : 999999;
  and.push({ price: { $gte: min, $lte: max } });

  if (and.length === 0) return {};
  return and.length === 1 ? and[0] : { $and: and };
}

/* -------------------------------------------------------------------------- */
/* utils: tri -> $sort                                                         */
/* -------------------------------------------------------------------------- */
/**
 * Tri disponibles:
 *  - "name-asc"    → { name: 1 }
 *  - "name-desc"   → { name: -1 }
 *  - "price-asc"   → { price: 1 }
 *  - "price-desc"  → { price: -1 }
 *  - "date-desc"   → { release_date_parsed: -1 }
 *  - "date-asc"    → { release_date_parsed: 1 }
 *  - "rating-desc" → { user_score: -1 }
 *
 * ÉQUIVALENT "commande Mongo":
 *    db.games.find(...).sort({ price: -1 })
 */
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
/* utils: projection liste                                                     */
/* -------------------------------------------------------------------------- */
/**
 * Projection par défaut pour les cartes:
 *  { name:1, header_image:1, genres:1, price:1 }
 *
 * ÉQUIVALENT "commande Mongo":
 *    db.games.find(query, { name:1, header_image:1, genres:1, price:1 })
 */
function buildProjectList(reqProjection) {
  if (reqProjection && typeof reqProjection === "object") return reqProjection;
  return { name: 1, header_image: 1, genres: 1, price: 1 };
}

/* -------------------------------------------------------------------------- */
/* Pipeline principal: $facet items + total                                   */
/* -------------------------------------------------------------------------- */
/**
 * Étapes:
 *  - $addFields release_date_parsed (parse "Oct 21, 2008")
 *  - $match (issu de buildMatch)
 *  - $facet:
 *      items: $sort → $skip → $limit → $project
 *      meta:  $count: "total"
 *
 * ÉQUIVALENT "commande Mongo":
 *    db.games.aggregate([
 *      { $addFields: { release_date_parsed: { $dateFromString: { dateString:"$release_date", format:"%b %d, %Y", onError:null, onNull:null }}}},
 *      { $match: ... },
 *      { $facet: {
 *          items: [ { $sort: ... }, { $skip: N }, { $limit: L }, { $project: ... } ],
 *          meta:  [ { $count: "total" } ]
 *      }},
 *      { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
 *      { $addFields: { total: { $ifNull: ["$meta.total", 0] } } },
 *      { $project: { meta: 0 } }
 *    ])
 */
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
    Object.keys($match).length ? { $match } : null,
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
  ].filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* POST /api/games/search                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Body JSON attendu:
 * {
 *   filters: {
 *     category, search, platforms:{windows,mac,linux},
 *     genre, language, multiplayer, developer,
 *     priceMin, priceMax, gotyYear
 *   },
 *   sort: "name-asc" | "price-desc" | "date-asc" | "rating-desc" | ...,
 *   page: 1, limit: 40,
 *   projection: { name:1, header_image:1, ... },    // optionnel
 *   withTotal: true                                  // optionnel (perf)
 * }
 *
 * NOTE perf: on peut mettre withTotal=false à partir de la page 2,
 * pour éviter le $count coûteux; on déduit alors "hasMore" via (items.length === limit).
 */
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

    // Variante plus légère (sans count) quand withTotal=false
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
          { $sort: buildSort(sort) },
          { $skip: skip },
          { $limit: Math.max(1, Number(limit)) },
          { $project: buildProjectList(projection) },
        ];

    const out = await Game.aggregate(pipeline).allowDiskUse(true);

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
/**
 * Pipeline commun:
 *   [{ $match: ...? },
 *    { $unwind: "$<field>" },
 *    { $group: { _id: { $trim: { input: { $toString: "$<field>" } } } } },
 *    { $match: { _id: { $ne: "" } } },
 *    { $sort: { _id: 1 } },
 *    { $project: { _id: 0, value: "$_id" } }]
 *
 * ÉQUIVALENT "commande Mongo":
 *   db.games.aggregate([
 *     { $unwind: "$genres" },
 *     { $group: { _id: "$genres" } },
 *     { $sort: { _id: 1 } },
 *     { $project: { value: "$_id", _id: 0 } }
 *   ])
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
/* GET /api/games/:id  (par _id ou appid)                                     */
/* -------------------------------------------------------------------------- */
/**
 * ÉQUIVALENT "commande Mongo":
 *  - Par _id:
 *      db.games.find({ _id: ObjectId("...") })
 *  - Sinon par appid (string dans ton dataset):
 *      db.games.find({ appid: "<id>" })
 */
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
/* RAW AGGREGATE endpoint (exécuter des pipelines bruts)                      */
/* -------------------------------------------------------------------------- */
/**
 * POST /api/games/agg
 * Body: { pipeline: [...] }  OU  { command: "db.games.aggregate([ ... ])" }
 * Options: { allowDiskUse: true, maxTimeMS: 5000 }
 *
 * Sécurité: on whiteliste les stages + on refuse $where/$function/$accumulator.
 *
 * ÉQUIVALENT "commande Mongo":
 *   db.games.aggregate([ ... ])
 */
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

export default router;
