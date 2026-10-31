import { Router } from "express";
import {
  updateNotificationPreferences,
  updateMe,
  changePassword,
  deactivateMe,
} from "../controllers/userController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.patch("/me", authorize("customer"), updateMe);
router.patch("/me/password", changePassword);
router.patch("/me/deactivate", authorize("customer"), deactivateMe);
router.patch("/me/notification-preferences", updateNotificationPreferences);

export default router;
