
import { Router } from "express";
import {
  cashIn,
  transfer,
  getTransactions,
  getTransactionById,
  cancelTransaction,
  getPendingTransfers,
  approveTransfer,
  rejectTransfer,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/cash-in", protect, authorize("customer"), cashIn);
router.post("/transfer", protect, authorize("customer"), transfer);
router.get("/", protect, authorize("customer"), getTransactions);

// Staff or admin transaction review
router.get(
  "/review/pending",
  protect,
  authorize("staff", "admin"),
  getPendingTransfers
);
router.patch(
  "/:id/approve",
  protect,
  authorize("staff", "admin"),
  approveTransfer
);
router.patch(
  "/:id/reject",
  protect,
  authorize("staff", "admin"),
  rejectTransfer
);

router.get(
  "/:id",
  protect,
  authorize("customer", "staff", "admin"),
  getTransactionById
);
router.patch("/:id/cancel", protect, authorize("customer"), cancelTransaction);

export default router;
