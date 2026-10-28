import { Router } from "express";
import {
  cashIn,
  transfer,
  getTransactions,
  getTransactionById,
  cancelTransaction,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";

const router = Router();

router.post(
  "/cash-in", 
  protect, authorize("customer"), 
  idempotency, cashIn
);

router.post(
  "/transfer", 
  protect, 
  authorize("customer"), 
  idempotency, transfer
);

router.get(
  "/", 
  protect, 
  authorize("customer"), 
  getTransactions
);

router.get(
  "/:id",
  protect,
  authorize("customer", "staff"),
  getTransactionById
);

router.patch(
  "/:id/cancel", 
  protect, 
  authorize("customer"), 
  cancelTransaction
);

export default router;
