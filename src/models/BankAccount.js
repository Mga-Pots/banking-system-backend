import mongoose from "mongoose";

const bankAccountSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, required: true, unique: true, trim: true },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["active", "frozen", "closed"],
      default: "active",
    },
  },
  { timestamps: true }
);

export default mongoose.model("BankAccount", bankAccountSchema);
