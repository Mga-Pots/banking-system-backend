import AuditLog from "../models/AuditLog.js";

/**
 * Records a system audit event.
 *
 * Only pass explicitly approved, non-sensitive metadata.
 * Do not pass passwords, tokens, identity documents,
 * transaction amounts, or account balances.
 */
export const writeAuditLog = async ({
  actor,
  actorRole,
  action,
  targetType,
  targetId = null,
  outcome = "success",
  metadata = {},
  session,
}) => {
  const auditEntry = {
    actor,
    actorRole,
    action,
    targetType,
    targetId,
    outcome,
    metadata,
  };

  const [createdAuditLog] = await AuditLog.create(
    [auditEntry],
    session ? { session } : {}
  );

  return createdAuditLog;
};
