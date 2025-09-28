import { Item } from "../models/Item.js";

export async function listItems(req, res, next) {
  try {
    const items = await Item.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

export async function getItem(req, res, next) {
  try {
    const item = await Item.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function createItem(req, res, next) {
  try {
    const item = await Item.create({
      name: req.body.name,
      description: req.body.description || ""
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req, res, next) {
  try {
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      { $set: { name: req.body.name, description: req.body.description || "" } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req, res, next) {
  try {
    const item = await Item.findByIdAndDelete(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
