import { Router } from "express";
import { getAdminNotificationLogs } from "../controllers/notificationController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect, authorize("admin"));

router.get("/notifications", getAdminNotificationLogs);

export default router;
