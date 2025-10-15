// src/server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectDB } from "./config/db.js";
import gamesRouter from "./routes/games.js";

dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// API
app.use("/api/games", gamesRouter);


// Fichiers statiques (public/ servi à la racine "/")
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

// Page d'accueil
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// (optionnel) fallback SPA: renvoyer index.html pour autres routes non-API
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

// Healthcheck
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Démarrage
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const URI  = process.env.MONGODB_URI;

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
