
import { Router } from "express";
import {
  getAllAdminTransactions,
  updateAdminTransactionStatus,
  getPendingTransfers,
  approveTransfer,
  rejectTransfer,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect);


router.get(
  "/transactions",
  authorize("staff"),
  getAllAdminTransactions
);

router.patch(
  "/transactions/:id/status",
  authorize("staff"),
  updateAdminTransactionStatus
);

router.get(
  "/transactions/review/pending",
  authorize("staff"),
  getPendingTransfers
);

router.patch(
  "/transactions/:id/approve",
  authorize("staff"),
  approveTransfer
);

router.patch(
  "/transactions/:id/reject",
  authorize("staff"),
  rejectTransfer
);

export default router;
