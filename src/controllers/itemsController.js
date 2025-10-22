/**
 * =====================================================================
 * Items Controller (Express + Mongoose)
 * ---------------------------------------------------------------------
 * Purpose
 * - Exposes CRUD handlers for the Item resource.
 * - Each handler follows the Express signature (req, res, next).
 * - Uses the Mongoose model `Item` (imported from ../models/Item.js).
 *
 * How it fits in the app
 * - Typically used in a router, e.g.:
 *     import * as items from "./controllers/items.js";
 *     router.get   ("/items",     items.listItems);
 *     router.get   ("/items/:id", items.getItem);
 *     router.post  ("/items",     items.createItem);
 *     router.put   ("/items/:id", items.updateItem);
 *     router.delete("/items/:id", items.deleteItem);
 *
 * Conventions & Notes
 * - All DB reads use `.lean()` to return plain JS objects (faster, not hydrated
 *   Mongoose documents). Adjust if you need document instance methods/middleware.
 * - Errors are forwarded to Express error middleware via `next(err)`.
 * - HTTP status codes:
 *     • 200 OK   -> successful GET/PUT
 *     • 201 Created -> successful POST with created resource in body
 *     • 204 No Content -> successful DELETE (no response body)
 *     • 404 Not Found -> when an Item does not exist for the given :id
 * - Validation:
 *     • `createItem` relies on the Item schema to validate required fields.
 *     • `updateItem` sets `runValidators:true` to enforce schema on updates.
 * - Sorting:
 *     • `listItems` sorts by `createdAt` (descending). Ensure your Item schema
 *       has timestamps enabled if you rely on this field.
 * =====================================================================
 */

import { Item } from "../models/Item.js";

/**
 * GET /items
 * Lists all items, most recent first.
 *
 * @param {import("express").Request} req - Incoming request (no query used here).
 * @param {import("express").Response} res - Outgoing response; JSON array is returned.
 * @param {import("express").NextFunction} next - Error forwarder to Express middleware.
 * @returns {Promise<void>}
 *
 * Response
 * - 200 OK with body: Item[] (plain objects due to .lean())
 *
 * Side effects
 * - None (read-only).
 */
export async function listItems(req, res, next) {
  try {
    // Query all items and sort by newest first. `.lean()` returns plain objects (better perf).
    const items = await Item.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /items/:id
 * Retrieves a single item by its MongoDB ObjectId.
 *
 * @param {import("express").Request} req - Uses req.params.id to look up the item.
 * @param {import("express").Response} res - Sends the found item or a 404.
 * @param {import("express").NextFunction} next - Error forwarder to Express middleware.
 * @returns {Promise<void>}
 *
 * Response
 * - 200 OK with body: Item (plain object) if found
 * - 404 Not Found with body: { error: "not_found" } if the id is valid format but no document
 *
 * Notes
 * - If req.params.id is malformed (invalid ObjectId), Mongoose will throw; we pass to `next(err)`.
 */
export async function getItem(req, res, next) {
  try {
    const item = await Item.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /items
 * Creates a new item.
 *
 * @param {import("express").Request} req - Expects body fields:
 *    - name {string} (required by schema)
 *    - description {string} (optional; defaults to "")
 * @param {import("express").Response} res - Returns the created item.
 * @param {import("express").NextFunction} next - Error forwarder (validation, etc.).
 * @returns {Promise<void>}
 *
 * Response
 * - 201 Created with body: created Item (Mongoose doc serialized to JSON)
 *
 * Validation & Security
 * - Relies on the Item schema for required/format validation.
 * - Consider sanitizing/whitelisting req.body upstream (middleware) to avoid
 *   unwanted fields (e.g., using express-validator or a schema validator).
 */
export async function createItem(req, res, next) {
  try {
    const item = await Item.create({
      name: req.body.name,
      description: req.body.description || ""
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /items/:id
 * Updates an existing item in place.
 *
 * @param {import("express").Request} req - Uses req.params.id and body fields:
 *    - name {string}
 *    - description {string} (optional; defaults to "")
 * @param {import("express").Response} res - Returns the updated item or 404.
 * @param {import("express").NextFunction} next - Forwards errors to error middleware.
 * @returns {Promise<void>}
 *
 * Response
 * - 200 OK with body: updated Item (plain object due to .lean())
 * - 404 Not Found with body: { error: "not_found" } if no document matches :id
 *
 * Options explained
 * - { new: true }        -> return the document _after_ update.
 * - { runValidators:true } -> enforce schema validation on the update operation.
 */
export async function updateItem(req, res, next) {
  try {
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      { $set: { name: req.body.name, description: req.body.description || "" } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /items/:id
 * Permanently removes an item by id.
 *
 * @param {import("express").Request} req - Uses req.params.id.
 * @param {import("express").Response} res - Sends 204 on success, 404 if missing.
 * @param {import("express").NextFunction} next - Error forwarder.
 * @returns {Promise<void>}
 *
 * Response
 * - 204 No Content (no body) on successful deletion
 * - 404 Not Found with body: { error: "not_found" } if nothing to delete
 *
 * Notes
 * - `.lean()` after deletion is harmless here (the doc is returned then converted).
 * - If you need soft-deletes, swap this for a flag update instead.
 */
export async function deleteItem(req, res, next) {
  try {
    const item = await Item.findByIdAndDelete(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
