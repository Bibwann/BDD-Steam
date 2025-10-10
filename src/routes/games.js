import { Router } from "express";
import { Game } from "../models/Game.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const list = await Game.find().lean();
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const doc = await Game.create(req.body);
    res.status(201).json(doc);
  } catch (e) {
    next(e);
  }
});

export default router;
