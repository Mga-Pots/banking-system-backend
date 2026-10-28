
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

// Staff transaction operations.
// Existing role permissions are preserved temporarily;
// role restrictions will be handled in a separate step.
router.get(
  "/transactions",
  authorize("staff", "admin"),
  getAllAdminTransactions
);

router.patch(
  "/transactions/:id/status",
  authorize("staff", "admin"),
  updateAdminTransactionStatus
);

router.get(
  "/transactions/review/pending",
  authorize("staff", "admin"),
  getPendingTransfers
);

router.patch(
  "/transactions/:id/approve",
  authorize("staff", "admin"),
  approveTransfer
);

router.patch(
  "/transactions/:id/reject",
  authorize("staff", "admin"),
  rejectTransfer
);

export default router;
