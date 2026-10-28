import { Router } from "express";
import { updateNotificationPreferences } from "../controllers/userController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.use(protect);
router.patch("/me/notification-preferences", updateNotificationPreferences);

export default router;
