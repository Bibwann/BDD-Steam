import { Router } from "express";
import { Item } from "../models/Item.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const items = await Item.find().lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const item = await Item.create(req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

export default router;
