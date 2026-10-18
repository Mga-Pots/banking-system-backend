import { Router } from "express";
import { cashIn, transfer } from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/cash-in", protect, authorize("customer"), cashIn);
router.post("/transfer", protect, authorize("customer"), transfer);

export default router;
