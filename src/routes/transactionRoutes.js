import { Router } from "express";
import { cashIn } from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/cash-in", protect, authorize("customer"), cashIn);

export default router;
