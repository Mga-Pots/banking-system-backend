
import { Router } from "express";
import { getAdminNotificationLogs } from "../controllers/notificationController.js";
import {
  createStaff,
  updateStaffStatus,
  getAdminUsers,
} from "../controllers/adminController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get(
  "/users", 
  authorize("admin"), 
  getAdminUsers
);

router.get(
  "/notifications",
  authorize("admin"),
  getAdminNotificationLogs
);

router.post(
  "/staff",
  authorize("admin"),
  createStaff
);

router.patch(
  "/staff/:id/status",
  authorize("admin"),
  updateStaffStatus
);

export default router;
