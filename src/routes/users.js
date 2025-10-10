// no accents in code
import { Router } from "express";
import { User } from "../models/User.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const list = await User.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, email } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: "name_and_email_required" });
    }
    const doc = await User.create({ name, email });
    res.status(201).json(doc);
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ error: "email_already_exists" });
    }
    next(e);
  }
});

export default router;
