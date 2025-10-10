import mongoose from "mongoose";

const gameSchema = new mongoose.Schema(
  {
    title: { type: String },
    genre: { type: String },
    platform: { type: String },
    release_date: { type: Date }
  },
  { timestamps: true }
);

export const Game = mongoose.model("Game", gameSchema, "games");
