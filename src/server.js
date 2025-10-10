import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";

import { fileURLToPath } from "node:url";
import { connectDB } from "./config/db.js";

import gamesRouter from "./routes/games.js";
import usersRouter from "./routes/users.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/games", gamesRouter);
app.use("/api/users", usersRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
const URI = process.env.MONGODB_URI;

connectDB(URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`site running at http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("failed to connect mongodb", e);
    process.exit(1);
  });
