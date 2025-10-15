// src/models/Game.js
import mongoose from "mongoose";

const GameSchema = new mongoose.Schema({
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
  goty_year: Number,
  appid: String,
}, { collection: "games" }); 

const Game = mongoose.models.Game || mongoose.model("Game", GameSchema);
export default Game;