import { Router } from "express";
import {
  cashIn,
  transfer,
  getTransactions,
  getTransactionById,
  cancelTransaction,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/cash-in", protect, authorize("customer"), cashIn);
router.post("/transfer", protect, authorize("customer"), transfer);
router.get("/", protect, authorize("customer"), getTransactions);
router.get("/:id", protect, authorize("customer", "staff", "admin"), getTransactionById);
router.patch("/:id/cancel", protect, authorize("customer"), cancelTransaction);

export default router;
