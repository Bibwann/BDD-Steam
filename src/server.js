// src/server.js

/**
 * =====================================================================
 * HTTP Server bootstrap (Express + MongoDB)
 * ---------------------------------------------------------------------
 * What this file does
 * - Loads environment variables (.env) and initializes an Express app.
 * - Wires common middlewares (CORS, JSON body parsing, logging).
 * - Mounts API routes under /api/games.
 * - Serves the frontend (static files from /public) and provides an SPA
 *   fallback so client-side routing works on hard refresh.
 * - Connects to MongoDB before starting to listen for HTTP traffic.
 *
 * Key integration points
 * - `connectDB(URI)` opens the default Mongoose connection. If the URI is
 *   missing/invalid, startup fails fast.
 * - The frontend expects index.html at the root (/) and static assets from /public.
 * - The games API lives under /api/games (see src/routes/games.js).
 *
 * Important ordering note
 * - The wildcard SPA fallback (`app.get("*", ...)`) will handle ANY non-API
 *   path before routes defined after it. If you want `/health` to return JSON,
 *   define it BEFORE the wildcard, or rename it to `/api/health`.
 *
 * Security & ops (recommendations)
 * - CORS is currently open (`cors()` with defaults). Restrict `origin` in prod.
 * - `morgan("dev")` is great for dev; prefer a structured logger in prod.
 * - Consider trust proxy / rate limiting / helmet() for hardened deployments.
 * =====================================================================
 */

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectDB } from "./config/db.js";
import gamesRouter from "./routes/games.js";

dotenv.config(); // Loads .env into process.env early (PORT, HOST, MONGODB_URI, ...)

/* -------------------------------------------------------------------------- */
/* ESM __filename / __dirname shims                                           */
/* -------------------------------------------------------------------------- */
/**
 * In ES modules, __filename/__dirname are not defined. We derive them from
 * import.meta.url in order to resolve the /public folder reliably regardless
 * of where the process is started from.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

/* -------------------------------------------------------------------------- */
/* Global middlewares                                                         */
/* -------------------------------------------------------------------------- */
/**
 * CORS: with no options, this allows all origins. In production, restrict:
 *   app.use(cors({ origin: ["https://your.app"], credentials: true }));
 */
app.use(cors());

/**
 * Body parser for JSON requests. Limit can be tuned if large payloads are expected:
 *   app.use(express.json({ limit: "1mb" }));
 */
app.use(express.json());

/**
 * HTTP request logger. "dev" format is concise for development.
 * For production, consider "combined" or a JSON logger (pino/winston).
 */
app.use(morgan("dev"));

/* -------------------------------------------------------------------------- */
/* API routes                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Mount the games REST API under /api/games.
 * All handlers are defined in src/routes/games.js.
 */
app.use("/api/games", gamesRouter);

/* -------------------------------------------------------------------------- */
/* Static assets + SPA fallback                                               */
/* -------------------------------------------------------------------------- */
/**
 * Serve the compiled/static frontend files from /public at the app root.
 * Requests for /css/*, /js/*, images, etc. are handled here.
 */
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

/**
 * Landing page:
 * - Serves the main HTML (SPA entry point) at "/".
 */
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

/**
 * SPA fallback:
 * - For any non-API route (i.e., NOT starting with "/api/"), send index.html.
 * - This enables client-side routing to handle the path.
 *
 * ⚠️ Route ordering caveat:
 * - Because this catches essentially all non-API GETs, any route you want to
 *   return JSON/HTML (like /health) MUST be defined BEFORE this handler,
 *   or moved under /api/*.
 */
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

/* -------------------------------------------------------------------------- */
/* Health check (currently shadowed by SPA fallback due to ordering)          */
/* -------------------------------------------------------------------------- */
/**
 * Healthcheck endpoint for uptime/load balancers.
 * NOTE: As written, this will NOT be reached because the SPA fallback above
 * will serve index.html for "/health". To make /health work:
 *   - Move this block ABOVE the wildcard fallback, or
 *   - Change the path to "/api/health".
 */
app.get("/health", (_req, res) => res.json({ status: "ok" }));

/* -------------------------------------------------------------------------- */
/* Startup: read env, connect DB, then listen                                 */
/* -------------------------------------------------------------------------- */
/**
 * PORT/HOST: defaults are sensible for local dev. On platforms like Heroku/
 * Render/Fly, the platform injects PORT via env.
 */
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

/**
 * MongoDB connection string:
 * - Must be set in env as MONGODB_URI, e.g.
 *   mongodb://localhost:27017/steam   or
 *   mongodb+srv://user:pass@cluster/steam
 * - `connectDB` will throw if missing.
 */
const URI  = process.env.MONGODB_URI;

/**
 * Boot sequence:
 * 1) Connect to MongoDB. If it fails, exit with code 1.
 * 2) Start the HTTP server only after the DB is ready (avoids serving 500s
 *    during warmup).
 */
connectDB(URI)
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`site running at http://${HOST}:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("failed to connect mongodb", e);
    process.exit(1);
  });

