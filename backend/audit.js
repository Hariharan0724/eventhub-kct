/**
 * EventHub - Centralized Audit Logging Service
 * Records all sensitive operations (user management, roll number updates,
 * event approvals/rejections, attendance marking and corrections)
 */

const { getFirestore } = require('./firebase');

/**
 * Record an audit log entry in Firestore
 * @param {Object} params
 * @param {string} params.actorId - ID of user performing the action
 * @param {string} params.actorRole - Role of the actor ('admin', 'organizer', 'student')
 * @param {string} params.action - Action identifier (e.g. 'EVENT_APPROVED', 'ROLL_NUMBER_CHANGED')
 * @param {string} params.targetType - Target entity ('user', 'event', 'attendance', 'registration')
 * @param {string} params.targetId - ID of the affected target
 * @param {string} [params.reason] - Mandatory reason where applicable (e.g., rejections, corrections)
 * @param {Object} [params.details] - Non-sensitive delta / metadata
 */
async function recordAuditLog({
  actorId,
  actorRole,
  action,
  targetType,
  targetId,
  reason = null,
  details = null
}) {
  try {
    const db = getFirestore();
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const entry = {
      auditId,
      actorId: actorId || 'system',
      actorRole: actorRole || 'system',
      action,
      targetType,
      targetId: String(targetId || ''),
      reason: reason ? String(reason).trim() : null,
      details: details ? JSON.parse(JSON.stringify(details)) : null,
      timestamp: new Date().toISOString()
    };

    await db.collection('auditLogs').doc(auditId).set(entry);
    return entry;
  } catch (err) {
    console.error('Failed to write audit log entry:', err);
    // Non-blocking so audit failures don't crash primary write if DB is under stress
    return null;
  }
}

module.exports = {
  recordAuditLog
};
