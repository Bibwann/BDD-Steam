// src/models/Game.js
import mongoose from "mongoose";

/**
 * ================================================================
 * Game model (Mongoose)
 * ----------------------------------------------------------------
 * Purpose
 * - Represents a Steam-like "game" document stored in the "games"
 *   collection. This schema is intentionally permissive (strict:false)
 *   to stay compatible with a heterogeneous dataset that may include
 *   additional fields not declared here.
 *
 * Interactions
 * - Queried by API routes (e.g., /api/games/search, /api/games/distinct/*)
 *   to support filtering, sorting, and projections used by the frontend.
 * - Fields included here match what the client typically requests:
 *   appid, name, release_date, price, platforms, developers, publishers,
 *   genres, supported_languages, header_image, user_score, recommendations, etc.
 *
 * Schema design notes
 * - `strict:false`: unknown fields from the dataset are allowed and will
 *   be persisted. Useful when ingesting raw Steam dumps with extra keys.
 * - Indexes are created to accelerate common queries/sorts (by appid, name,
 *   scores, recommendations, price, platforms, genres, languages).
 * - `appid` is unique+sparse to guard against duplicates when provided.
 * ================================================================
 */
const GameSchema = new mongoose.Schema(
  {
    /**
     * Steam application identifier.
     * - Stored as string for consistency (some datasets contain non-numeric IDs).
     * - Indexed and additionally unique+sparse below to avoid duplicates.
     */
    appid: { type: String, required: true, index: true },

    /** Human-readable title of the game. */
    name: String,

    /**
     * Release date as a string (kept as-is from source dataset).
     * - Consider normalizing to Date for range queries if needed.
     */
    release_date: String,

    /**
     * Price in default currency units.
     * - Number type used for numeric sorting/filtering.
     * - 0 typically represents "Free".
     */
    price: Number,

    /** Platform availability flags used by platform filters. */
    windows: Boolean,
    mac: Boolean,
    linux: Boolean,

    /** Company/individuals that built the game. */
    developers: [String],

    /** Publishing companies associated with the game. */
    publishers: [String],

    /** High-level categories/genres (e.g., "Action", "RPG"). */
    genres: [String],

    /** Steam categories/feature flags (e.g., "Single-player", "Co-op"). */
    categories: [String],

    /** Languages supported (e.g., "English", "Spanish"). */
    supported_languages: [String],

    /** URL to the game's header/banner image. */
    header_image: String,

    /**
     * Aggregate user rating (0..100 or similar scale depending on dataset).
     * - Used for sorting/ranking in the UI.
     */
    user_score: Number,

    /**
     * Number of Steam "recommendations"/reviews or similar popularity signal.
     * - Used for sorting and badges in the UI.
     */
    recommendations: Number,

    /**
     * Optional flag denoting "favorite" on the document itself.
     * - Frontend currently maintains favorites per profile in localStorage,
     *   so this field may be legacy/optional depending on the backend use.
     */
    favorite: Boolean,

    // Keep compatibility with extra fields from the dataset:
    // Any additional keys present in source documents will be preserved
    // because schema uses { strict:false } (see schema options below).
  },
  {
    collection: "games",
    /**
     * strict:false allows fields not defined in the schema to be stored.
     * This is intentional to support raw datasets with many extra keys.
     * Switch to true or "throw" if you want to enforce a closed schema.
     */
    strict: false,
  }
);

/* =============================== Indexes =============================== *
 * These indexes support common API queries and sorts used by the frontend.
 * Note: Ensure your MongoDB instance has resources to build these.
 */

/** Unique (when present) identifier to prevent duplicate entries by appid. */
GameSchema.index({ appid: 1 }, { unique: true, sparse: true });

/** Speeds up name lookup and sorting A–Z / Z–A. */
GameSchema.index({ name: 1 });

/** Optimizes sorting by highest user score first. */
GameSchema.index({ user_score: -1 });

/** Optimizes sorting by most recommended/popular first. */
GameSchema.index({ recommendations: -1 });

/** Enables efficient price range filters and price-based sorting. */
GameSchema.index({ price: 1 });

/**
 * Compound index for platform filters (windows/mac/linux).
 * Queries that filter combinations of these flags benefit from this.
 */
GameSchema.index({ windows: 1, mac: 1, linux: 1 });

/** Accelerates equality/membership queries on genres. */
GameSchema.index({ genres: 1 });

/** Accelerates filtering by supported language(s). */
GameSchema.index({ supported_languages: 1 });

/**
 * Model export:
 * - Reuse existing model if it was already compiled (helps in dev/hot reload)
 *   to avoid OverwriteModelError.
 */
const Game =
  mongoose.models.Game || mongoose.model("Game", GameSchema);

export default Game;
