/**
 * ============================================================
 * MongoDB Connection Helper (Mongoose, ESM)
 * ------------------------------------------------------------
 * What this module does:
 * - Exposes a single async function `connectDB(uri)` that opens
 *   the default Mongoose connection to MongoDB and returns it.
 * - Enables `strictQuery` globally so only schema-declared
 *   paths are allowed in query filters (safer & less surprising).
 *
 * How it interacts with the rest of the app:
 * - Typically imported by your server bootstrap (e.g., server.js,
 *   app.js, or an API entry file) and called once at startup.
 * - The returned `mongoose.connection` is a singleton-like object
 *   (Mongoose's default connection). Your models registered via
 *   `mongoose.model(...)` will bind to this connection.
 *
 * Usage example:
 * ------------------------------------------------------------
 * import { connectDB } from "./db/connect.js";
 *
 * const uri = process.env.MONGODB_URI;
 * try {
 *   await connectDB(uri);
 *   // Now you can import/register models and start the HTTP server
 *   app.listen(PORT, () => console.log(`listening on ${PORT}`));
 * } catch (err) {
 *   console.error("Failed to connect to MongoDB:", err);
 *   process.exit(1);
 * }
 *
 * Notes & best practices:
 * - Call `connectDB` only once during startup. Repeated calls to
 *   `mongoose.connect()` in the same process are unnecessary and
 *   can cause confusing states in development with hot reloads.
 * - Keep `MONGODB_URI` outside of source control (env var, secret).
 * - Add process-level listeners (optional) elsewhere if you want to
 *   log `connected`, `error`, `disconnected`, etc. events:
 *     mongoose.connection.on("error", console.error);
 *     mongoose.connection.on("disconnected", ...);
 * ============================================================
 */

import mongoose from "mongoose";

/**
 * Opens the default Mongoose connection using the provided URI.
 *
 * @param {string} uri - A valid MongoDB connection string.
 *   Examples:
 *   - "mongodb://localhost:27017/steam"
 *   - "mongodb+srv://user:pass@cluster0.xyz.mongodb.net/steam"
 *
 * @returns {Promise<mongoose.Connection>}
 *   Resolves to the active Mongoose connection object once connected.
 *
 * @throws {Error}
 *   If `uri` is missing/empty, or if `mongoose.connect()` fails.
 *
 * @sideEffects
 *   - Sets `strictQuery` globally (applies to all schemas/queries).
 *   - Establishes network sockets to MongoDB and logs to stdout.
 */
export async function connectDB(uri) {
  // Guard against missing configuration early to fail fast with a clear message.
  if (!uri) {
    throw new Error("MONGODB_URI is missing");
  }

  // Enforce safer query behavior globally:
  // Only fields defined in your schemas can be used in query filters.
  // Helps catch typos and reduces risk of unexpected queries.
  mongoose.set("strictQuery", true);

  // `mongoose.connect` returns when the initial connection succeeds.
  // It uses the *default* connection under the hood.
  await mongoose.connect(uri);

  // Simple operational log; you can replace with your logger if needed.
  console.log("mongodb connected");

  // Expose the connection so callers can attach listeners if they want.
  return mongoose.connection;
}
