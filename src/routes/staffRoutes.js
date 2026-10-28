import { Router } from "express";
import {
  getAllStaffTransactions,
  updateStaffTransactionStatus,
  getPendingTransfers,
  approveTransfer,
  rejectTransfer,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";
import {
  getStaffCustomers,
  getStaffCustomerById,
  verifyCustomer,
  getStaffAccounts,
  updateCustomerStatus,
} from "../controllers/staffController.js";

const router = Router();

router.use(protect);


router.get(
  "/transactions",
  authorize("staff"),
  getAllStaffTransactions
);

router.patch(
  "/transactions/:id/status",
  authorize("staff"),
  updateStaffTransactionStatus
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

router.patch(
  "/customers/:id/status",
  authorize("staff"),
  updateCustomerStatus
);

router.get(
  "/customers",
  authorize("staff"),
  getStaffCustomers
);

router.get(
  "/customers/:id",
  authorize("staff"),
  getStaffCustomerById
);

router.patch(
  "/customers/:id/verify",
  authorize("staff"),
  verifyCustomer
);

router.get(
  "/accounts",
  authorize("staff"),
  getStaffAccounts
);

export default router;
