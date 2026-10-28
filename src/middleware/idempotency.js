import crypto from "node:crypto";
import IdempotencyRecord from "../models/IdempotencyRecord.js";

const IN_FLIGHT_TIMEOUT_MS = 60000; // 60 seconds

// Recursively sorts object keys so different JSON key orderings produce identical hashes.
export const canonicalize = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  if (obj && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
      }, {});
  }
  return obj;
};

export const idempotency = async (req, res, next) => {
  const rawKey = req.header("idempotency-key") || req.header("x-idempotency-key");
  const keyStr = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  const key = typeof keyStr === "string" ? keyStr.trim() : "";
  if (!key) return next();

  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(req.body ?? {})))
    .digest("hex");

  try {
    try {
      const record = await IdempotencyRecord.create({
        key,
        user: req.user._id,
        endpoint: req.originalUrl,
        requestHash,
        status: "in_progress",
      });
      req.idempotencyRecordId = record._id;
    } catch (err) {
      if (err?.code === 11000) {
        const existing = await IdempotencyRecord.findOne({ user: req.user._id, key });
        if (!existing) {
          return res.status(500).json({ success: false, message: "Idempotency conflict" });
        }

        if (existing.status === "in_progress") {
          const isStale =
            Date.now() - new Date(existing.createdAt).getTime() > IN_FLIGHT_TIMEOUT_MS;
          if (!isStale) {
            return res.status(409).json({
              success: false,
              message:
                "A transaction with this idempotency key is currently processing. Please wait.",
            });
          }

          // Atomically reclaim stale in-progress lock (QA-SUG-001)
          const reclaimed = await IdempotencyRecord.findOneAndUpdate(
            { _id: existing._id, status: "in_progress", createdAt: existing.createdAt },
            {
              $set: {
                requestHash,
                status: "in_progress",
                createdAt: new Date(),
                responseStatus: undefined,
                responseBody: undefined,
              },
            },
            { new: true }
          );
          if (!reclaimed) {
            return res.status(409).json({
              success: false,
              message:
                "A transaction with this idempotency key is currently processing. Please wait.",
            });
          }
          req.idempotencyRecordId = reclaimed._id;
        } else if (existing.status === "failed") {
          // Reclaim failed record for retry
          const reclaimed = await IdempotencyRecord.findOneAndUpdate(
            { _id: existing._id, status: "failed" },
            {
              $set: {
                requestHash,
                status: "in_progress",
                createdAt: new Date(),
                responseStatus: undefined,
                responseBody: undefined,
              },
            },
            { new: true }
          );
          if (!reclaimed) {
            return res.status(409).json({
              success: false,
              message:
                "A transaction with this idempotency key is currently processing. Please wait.",
            });
          }
          req.idempotencyRecordId = reclaimed._id;
        } else {
          // status === "completed"
          if (existing.requestHash !== requestHash) {
            return res.status(400).json({
              success: false,
              message: "Idempotency key reused with different request payload",
            });
          }

          res.set("X-Cache-Lookup", "HIT");
          return res.status(existing.responseStatus).json(existing.responseBody);
        }
      } else {
        throw err;
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const statusCode = res.statusCode || 200;
      if (req.idempotencyRecordId) {
        const finalStatus = statusCode >= 200 && statusCode < 500 ? "completed" : "failed";
        IdempotencyRecord.findByIdAndUpdate(req.idempotencyRecordId, {
          status: finalStatus,
          responseStatus: statusCode,
          responseBody: body,
        })
          .catch((e) => console.error("Failed to update idempotency record:", e))
          .finally(() => {
            originalJson(body);
          });
        return res;
      }
      return originalJson(body);
    };

    return next();
  } catch (err) {
    console.error("Idempotency middleware error:", err);
    return res.status(500).json({ success: false, message: "Idempotency check failed" });
  }
};
