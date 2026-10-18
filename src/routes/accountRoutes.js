import { Router } from "express";
import {
  getMyAccount,
  getMyBalance,
  getAccountById,
} from "../controllers/accountController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

// "/me" routes must be registered before "/:id" or "me" would be read as an account ID
router.get("/me", protect, authorize("customer"), getMyAccount);
router.get("/me/balance", protect, authorize("customer"), getMyBalance);
router.get("/:id", protect, authorize("customer", "staff", "admin"), getAccountById);

export default router;
