import mongoose from "mongoose";

/**
 * =====================================================================
 * Goty model (Mongoose)
 * ---------------------------------------------------------------------
 * Purpose
 * - Stores one "Game of the Year" (GOTY) assignment per (profile, year).
 * - Enforced uniqueness guarantees that each profile can have at most
 *   one GOTY for a given calendar year.
 *
 * How this model is used
 * - Consumed by backend endpoints like:
 *     POST /api/games/goty/set    -> create or replace a GOTY for (profile, year)
 *     POST /api/games/goty/unset  -> remove a GOTY by {year, profile} or {appid, profile}
 * - The frontend calls those endpoints from the GOTY modal/typeahead and
 *   shows/removes the badge on game cards accordingly.
 *
 * Schema options
 * - collection: "gotys"   -> explicit MongoDB collection name.
 * - timestamps: true      -> automatically maintains createdAt/updatedAt.
 * - versionKey: false     -> disables the "__v" version key on documents.
 * =====================================================================
 */

/**
 * Per-profile GOTY assignments.
 * Exactly one (appid) per (profile, year).
 */
const GotySchema = new mongoose.Schema(
  {
    /**
     * Owner of the GOTY pick.
     * Limited to supported frontend personas. Indexed for fast lookups.
     */
    profile: {
      type: String,
      required: true,
      enum: ["kid", "person1", "person2"],
      index: true,
    },

    /**
     * Calendar year of the GOTY (e.g., 2024).
     * Indexed to speed up filtering by year.
     */
    year: { type: Number, required: true, index: true },

    /**
     * The selected game's Steam appid (string for consistency).
     * Indexed for quick reverse lookups (what year(s) for this game/profile?).
     */
    appid: { type: String, required: true, index: true },
  },
  {
    collection: "gotys",
    timestamps: true,   // adds createdAt, updatedAt
    versionKey: false,  // omit "__v"
  }
);

/**
 * Enforce uniqueness of one GOTY per (profile, year).
 * Example: ("person1", 2023) can only point to a single appid.
 */
GotySchema.index({ profile: 1, year: 1 }, { unique: true });

/**
 * Secondary compound index:
 * Speeds up queries like "is this app already GOTY for this profile?"
 * and listing/removing by (profile, appid) regardless of year.
 */
GotySchema.index({ profile: 1, appid: 1 });

/**
 * Model export:
 * - Reuse the compiled model if it exists (useful in dev/hot-reload)
 *   to avoid OverwriteModelError.
 */
export default mongoose.models.Goty || mongoose.model("Goty", GotySchema);
