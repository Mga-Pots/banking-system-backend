import { Router } from "express";
import {
  getMyAccount,
  getMyBalance,
  getMyCardDetails,
  getRecentRecipients,
  getAccountById,
  lookupAccount,
  freezeAccount,
  unfreezeAccount,
} from "../controllers/accountController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

// Customer routes
router.get("/me", protect, authorize("customer"), getMyAccount);
router.get("/me/balance", protect, authorize("customer"), getMyBalance);
router.post("/me/card-details", protect, authorize("customer"), getMyCardDetails);
router.get("/me/recent-recipients", protect, authorize("customer"), getRecentRecipients);
router.get("/lookup/:accountNumber", protect, authorize("customer"), lookupAccount);

// Staff/admin routes
router.patch(
  "/:id/freeze",
  protect,
  authorize("staff"),
  freezeAccount
);

router.patch(
  "/:id/unfreeze",
  protect,
  authorize("staff"),
  unfreezeAccount
);

// Account details
router.get(
  "/:id",
  protect,
  authorize("customer", "staff"),
  getAccountById
);

export default router;
