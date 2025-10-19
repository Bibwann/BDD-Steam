// src/models/Game.js
import mongoose from "mongoose";

const GameSchema = new mongoose.Schema(
  {
    appid: { type: String, required: true, index: true },
    name: String,
    release_date: String,
    price: Number,
    windows: Boolean,
    mac: Boolean,
    linux: Boolean,
    developers: [String],
    publishers: [String],
    genres: [String],
    categories: [String],
    supported_languages: [String],
    header_image: String,
    user_score: Number,
    recommendations: Number,
    favorite: Boolean,
    // mantener compatibilidad con campos extra del dataset
  },
  { collection: "games", strict: false }
);

GameSchema.index({ appid: 1 }, { unique: true, sparse: true });
GameSchema.index({ name: 1 });
GameSchema.index({ user_score: -1 });
GameSchema.index({ recommendations: -1 });
GameSchema.index({ price: 1 });
GameSchema.index({ windows: 1, mac: 1, linux: 1 });
GameSchema.index({ genres: 1 });
GameSchema.index({ supported_languages: 1 });

const Game =
  mongoose.models.Game || mongoose.model("Game", GameSchema);
export default Game;
