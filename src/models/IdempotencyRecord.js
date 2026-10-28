import mongoose from "mongoose";

const idempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    endpoint: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["in_progress", "completed", "failed"],
      default: "in_progress",
      required: true,
    },
    responseStatus: { type: Number },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, expires: 86400 },
  },
  { timestamps: false }
);

idempotencyRecordSchema.index({ user: 1, key: 1 }, { unique: true });

export default mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
