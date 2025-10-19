import mongoose from "mongoose";

/**
 * Per-profile GOTY assignments.
 * Unique per (profile, year).
 */
const GotySchema = new mongoose.Schema(
  {
    profile: {
      type: String,
      required: true,
      enum: ["kid", "person1", "person2"],
      index: true,
    },
    year: { type: Number, required: true, index: true },
    appid: { type: String, required: true, index: true },
  },
  {
    collection: "gotys",
    timestamps: true,
    versionKey: false,
  }
);

GotySchema.index({ profile: 1, year: 1 }, { unique: true });

GotySchema.index({ profile: 1, appid: 1 });

export default mongoose.models.Goty || mongoose.model("Goty", GotySchema);
