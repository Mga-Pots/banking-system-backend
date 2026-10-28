import { Router } from "express";
import { getAdminNotificationLogs } from "../controllers/notificationController.js";
import {
  getAllAdminTransactions,
  updateAdminTransactionStatus,
} from "../controllers/transactionController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/notifications", authorize("admin"), getAdminNotificationLogs);
router.get("/transactions", authorize("staff", "admin"), getAllAdminTransactions);
router.patch("/transactions/:id/status", authorize("staff", "admin"), updateAdminTransactionStatus);

export default router;
