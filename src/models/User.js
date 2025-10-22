import mongoose from "mongoose";

/**
 * =====================================================================
 * User model (Mongoose)
 * ---------------------------------------------------------------------
 * Purpose
 * - Represents an application user with a display name and a unique email.
 *
 * How it fits in the app
 * - Typical usage in controllers/services for creating and looking up users:
 *     const user = await User.create({ name, email });
 *     const found = await User.findOne({ email });
 *
 * Notes & recommendations
 * - `unique: true` on `email` creates a unique index (it is not a validator).
 *   Make sure the index exists in the database; handle duplicate key errors
 *   (E11000) in your API to return a friendly 409/400 response.
 * - `lowercase: true` ensures email is stored in canonical lower-case form.
 * - Add an email format validator if you need stricter input checking.
 * - `timestamps: true` automatically maintains `createdAt` and `updatedAt`.
 * =====================================================================
 */

const userSchema = new mongoose.Schema(
  {
    /**
     * Human-friendly name to display in the UI.
     * - Required
     * - Trimmed to remove leading/trailing whitespace
     */
    name: { type: String, required: true, trim: true },

    /**
     * Unique email address used as a login/contact key.
     * - Required
     * - Trimmed and normalized to lower-case before saving
     * - `unique: true` -> creates a unique index at the DB level
     */
    email: { type: String, required: true, trim: true, lowercase: true, unique: true }
  },
  {
    /**
     * Adds `createdAt` and `updatedAt` Date fields automatically.
     * Useful for auditing and sorting.
     */
    timestamps: true
  }
);

/**
 * Model export:
 * - Third argument "users" sets the explicit MongoDB collection name.
 * - If you omit it, Mongoose would default to the pluralized model name.
 */
export const User = mongoose.model("User", userSchema, "users");
