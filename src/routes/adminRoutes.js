import { Router } from "express";
import { getAdminNotificationLogs } from "../controllers/notificationController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/notifications", authorize("admin"), getAdminNotificationLogs);

export default router;