import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    referenceNumber: { 
      type: String, 
      required: true, 
      unique: true, 
      trim: true 
    },
    transactionType: {
      type: String,
      enum: ["cash_in", "transfer"],
      required: true,
    },
    amount: { type: Number, required: true, min: [1, "Amount must be at least 1 centavo"] },
    sourceAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },
    destinationAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled", "flagged"],
      default: "pending",
    },
    flagReason: { 
      type: String, 
      default: null 
    },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);
