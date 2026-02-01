import express, { type Request, type Response } from "express";
import { listTasks } from "../tasks.js";

const router = express.Router();

router.get("/", (_req: Request, res: Response) => {
  res.json(listTasks());
});

export default router;
