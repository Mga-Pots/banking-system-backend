import { Router } from "express";
import { register, login, me } from "../controllers/authController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, me);

// TEMPORARY: used to test role checks. Delete after testing.
router.get("/admin-check", protect, authorize("admin"), (req, res) => res.json({ ok: true }));

export default router;