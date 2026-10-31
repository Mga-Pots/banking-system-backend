import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import staffRoutes from "./routes/staffRoutes.js";

// CLIENT_URL may list several origins separated by commas.
// One origin stays a plain string; none leaves cors at its default, as before.
export const parseClientOrigins = (value) => {
  const list = String(value ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
};

const app = express();

app.use(
  cors({
    origin: parseClientOrigins(process.env.CLIENT_URL),
    exposedHeaders: ["X-Total-Count", "X-Unread-Count", "X-Cache-Lookup"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Idempotency-Key"],
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ success: true, data: { status: "ok" } }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/staff", staffRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: "Route not found" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "Server error" });
});

export default app;
