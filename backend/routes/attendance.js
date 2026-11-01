const express = require('express');
const router = express.Router();
const { getFirestore } = require('../firebase');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');
const { sendAttendanceConfirmedEmail } = require('../email');

// Active Server-Sent Events (SSE) live feed subscribers
const sseClients = new Set();

function broadcastAttendanceEvent(payload) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

/**
 * GET /api/attendance/live-stream
 * Server-Sent Events (SSE) stream for real-time check-in updates
 */
router.get('/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Initial connection handshake
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  // Keep-alive heartbeat every 20 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/**
 * Clean & extract Registration ID or Roll Number from scanner input
 * Handles raw string, JSON payload string, or URL format
 */
function parseScannerInput(input) {
  if (!input) return { id: '', rollNumber: '', eventId: null };
  let str = String(input).trim();

  // If input is JSON string like {"regId":"EVT-...", "rollNumber":"..."} or {"registrationId":"..."}
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      return {
        id: (parsed.regId || parsed.registrationId || parsed.id || '').trim().toUpperCase(),
        rollNumber: (parsed.rollNumber || parsed.registerNumber || '').trim().toUpperCase(),
        eventId: parsed.eventId || null
      };
    } catch (e) {
      // not valid JSON, treat as raw string
    }
  }

  // If input is a URL like .../my-registration.html?id=EVT-...
  if (str.includes('id=')) {
    const match = str.match(/[?&]id=([^&]+)/);
    if (match && match[1]) {
      return {
        id: decodeURIComponent(match[1]).trim().toUpperCase(),
        rollNumber: '',
        eventId: null
      };
    }
  }

  return {
    id: str.toUpperCase(),
    rollNumber: '',
    eventId: null
  };
}

/**
 * Helper to compute live event stats
 */
async function computeEventStats(db, eventId) {
  const regsSnapshot = await db.collection('registrations').where('eventId', '==', eventId).get();
  const regs = (regsSnapshot.docs || []).map(d => d.data());

  const totalRegistered = regs.length;
  const totalPresent = regs.filter(r => r.attendanceStatus === 'Present').length;
  const totalAbsent = totalRegistered - totalPresent;
  const attendanceRate = totalRegistered > 0 ? ((totalPresent / totalRegistered) * 100).toFixed(1) : '0.0';

  return {
    totalRegistered,
    totalPresent,
    totalAbsent,
    attendanceRate: parseFloat(attendanceRate)
  };
}

/**
 * Helper to find registration document by either Registration ID or Roll Number for an event
 */
async function findRegistration(db, eventId, parsed) {
  const { id, rollNumber } = parsed;

  // 1. Direct doc lookup by ID (e.g. EVT-2026-0001)
  if (id) {
    const docRef = await db.collection('registrations').doc(id).get();
    if (docRef.exists) {
      return { docRef: db.collection('registrations').doc(id), reg: docRef.data() };
    }
  }

  // 2. Query collection for registration where registrationId == id or rollNumber == id/rollNumber
  const eventRegsSnapshot = await db.collection('registrations').where('eventId', '==', eventId).get();
  const docs = eventRegsSnapshot.docs || [];

  for (const doc of docs) {
    const r = doc.data();
    const regRoll = (r.rollNumber || r.registerNumber || '').toUpperCase();
    if (id && r.registrationId && r.registrationId.toUpperCase() === id) {
      return { docRef: doc.ref || db.collection('registrations').doc(doc.id), reg: r };
    }
    if (id && regRoll === id) {
      return { docRef: doc.ref || db.collection('registrations').doc(doc.id), reg: r };
    }
    if (rollNumber && regRoll === rollNumber) {
      return { docRef: doc.ref || db.collection('registrations').doc(doc.id), reg: r };
    }
  }

  return null;
}

/**
 * POST /api/attendance/verify
 * Protected: Organizers & Admins ONLY
 * Pre-validates a scan without marking attendance
 */
router.post('/verify', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { registrationId, eventId } = req.body;

    if (!registrationId || !eventId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or Expired QR Pass'
      });
    }

    const parsed = parseScannerInput(registrationId);
    const db = getFirestore();

    // Check Event existence
    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Selected event not found in system.'
      });
    }
    const currentEvent = eventDoc.data();

    // Check Organizer authorization for this event
    if (req.user.role !== 'admin' && currentEvent.organizerId && currentEvent.organizerId !== req.user.id && currentEvent.createdBy !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You Are Not Authorized for This Event'
      });
    }

    // Lookup Registration
    const found = await findRegistration(db, eventId, parsed);
    if (!found) {
      return res.status(404).json({
        success: false,
        status: 'not_found',
        message: 'Registration Not Found'
      });
    }

    const reg = found.reg;

    // Check if belongs to wrong event
    if (reg.eventId !== eventId) {
      return res.status(400).json({
        success: false,
        status: 'wrong_event',
        message: 'Registration Not Found'
      });
    }

    // Check if already marked
    if (reg.attendanceStatus === 'Present') {
      return res.status(409).json({
        success: false,
        status: 'already_marked',
        message: 'Attendance Already Marked',
        checkInTime: reg.checkInTime,
        student: {
          studentName: reg.studentName,
          rollNumber: reg.rollNumber || reg.registerNumber,
          department: reg.department,
          year: reg.year,
          eventName: currentEvent.name
        }
      });
    }

    return res.status(200).json({
      success: true,
      status: 'valid',
      message: 'Valid Registration Ready for Attendance',
      student: {
        registrationId: reg.registrationId,
        studentName: reg.studentName,
        rollNumber: reg.rollNumber || reg.registerNumber,
        department: reg.department,
        year: reg.year,
        eventName: currentEvent.name
      }
    });

  } catch (err) {
    console.error('Error during attendance verification:', err);
    res.status(500).json({
      success: false,
      message: 'Server error verifying registration.'
    });
  }
});

/**
 * POST /api/attendance/mark
 * Protected: Organizers & Admins ONLY
 * Marks attendance and enforces the EXACT 5 security messages:
 * 1. "Attendance Marked Successfully" (HTTP 200)
 * 2. "Attendance Already Marked" (HTTP 409)
 * 3. "Registration Not Found" (HTTP 404)
 * 4. "You Are Not Authorized for This Event" (HTTP 403)
 * 5. "Invalid or Expired QR Pass" (HTTP 400)
 */
router.post('/mark', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { registrationId, eventId } = req.body;

    // 5. Invalid or Expired QR Pass
    if (!registrationId || !eventId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or Expired QR Pass'
      });
    }

    const parsed = parseScannerInput(registrationId);
    if (!parsed.id && !parsed.rollNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or Expired QR Pass'
      });
    }

    const db = getFirestore();

    // 1. Verify Event Existence
    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Event not found.'
      });
    }
    const currentEvent = eventDoc.data();

    // 4. Check Organizer Authorization: "You Are Not Authorized for This Event"
    if (req.user.role !== 'admin' && currentEvent.organizerId && currentEvent.organizerId !== req.user.id && currentEvent.createdBy !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You Are Not Authorized for This Event'
      });
    }

    // 3. Lookup Registration: "Registration Not Found"
    const found = await findRegistration(db, eventId, parsed);
    if (!found) {
      return res.status(404).json({
        success: false,
        message: 'Registration Not Found'
      });
    }

    const { docRef, reg } = found;

    // Verify event matching
    if (reg.eventId !== eventId) {
      return res.status(404).json({
        success: false,
        message: 'Registration Not Found'
      });
    }

    // 2. Check if Attendance is Already Marked: "Attendance Already Marked"
    if (reg.attendanceStatus === 'Present') {
      return res.status(409).json({
        success: false,
        message: 'Attendance Already Marked',
        checkInTime: reg.checkInTime,
        student: {
          studentName: reg.studentName,
          rollNumber: reg.rollNumber || reg.registerNumber,
          department: reg.department,
          year: reg.year,
          eventName: currentEvent.name
        }
      });
    }

    // Check concurrency against dedicated attendance collection
    const attendanceDocId = `att_${eventId}_${reg.registrationId}`;
    const existingAttDoc = await db.collection('attendance').doc(attendanceDocId).get();
    if (existingAttDoc.exists) {
      return res.status(409).json({
        success: false,
        message: 'Attendance Already Marked'
      });
    }

    // 1. Mark Attendance: "Attendance Marked Successfully"
    const checkInTime = new Date().toISOString();
    const studentRoll = reg.rollNumber || reg.registerNumber || '';

    // Update registration document
    await docRef.update({
      attendanceStatus: 'Present',
      checkInTime
    });

    // Write record to dedicated attendance collection for concurrency safety & history
    await db.collection('attendance').doc(attendanceDocId).set({
      attendanceId: attendanceDocId,
      eventId,
      eventName: currentEvent.name,
      registrationId: reg.registrationId,
      studentId: reg.userId || '',
      studentName: reg.studentName,
      rollNumberSnapshot: studentRoll,
      organizerId: req.user.id,
      organizerName: req.user.name,
      status: 'Present',
      checkInTime,
      timestamp: checkInTime
    });

    // Compute updated stats
    const updatedStats = await computeEventStats(db, eventId);

    // Update present count on event document
    try {
      await db.collection('events').doc(eventId).update({
        presentCount: updatedStats.totalPresent
      });
    } catch (e) {}

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ATTENDANCE_MARKED',
      targetType: 'attendance',
      targetId: attendanceDocId,
      details: {
        eventId,
        registrationId: reg.registrationId,
        rollNumber: studentRoll,
        studentName: reg.studentName
      }
    });

    // Broadcast check-in event to SSE subscribers (organizer & admin dashboards)
    broadcastAttendanceEvent({
      type: 'CHECK_IN',
      eventId,
      eventName: currentEvent.name,
      registrationId: reg.registrationId,
      studentName: reg.studentName,
      rollNumber: studentRoll,
      department: reg.department,
      checkInTime,
      updatedStats
    });

    // Send attendance confirmation email to student (non-blocking)
    if (reg.email) {
      sendAttendanceConfirmedEmail({
        to: reg.email,
        studentName: reg.studentName,
        eventName: currentEvent.name,
        checkInTime,
        rollNumber: studentRoll
      }).catch(err => console.error('[Attendance] Email dispatch error:', err));
    }

    return res.status(200).json({
      success: true,
      message: 'Attendance Marked Successfully',
      student: {
        registrationId: reg.registrationId,
        studentName: reg.studentName,
        rollNumber: studentRoll,
        department: reg.department,
        year: reg.year,
        eventName: currentEvent.name,
        checkInTime
      },
      stats: updatedStats
    });

  } catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to record attendance due to server error.'
    });
  }
});

/**
 * GET /api/attendance/event/:id
 * Protected: Organizers & Admins ONLY
 * Retrieves detailed attendance audit records for an event
 */
router.get('/event/:id', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventId = req.params.id;

    // Check event authorization
    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const currentEvent = eventDoc.data();

    if (req.user.role !== 'admin' && currentEvent.organizerId && currentEvent.organizerId !== req.user.id && currentEvent.createdBy !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You Are Not Authorized for This Event'
      });
    }

    const attSnap = await db.collection('attendance').where('eventId', '==', eventId).get();
    const records = (attSnap.docs || []).map(d => d.data());

    // Sort by check-in time descending
    records.sort((a, b) => new Date(b.timestamp || b.checkInTime) - new Date(a.timestamp || a.checkInTime));

    const stats = await computeEventStats(db, eventId);

    res.json({
      success: true,
      count: records.length,
      stats,
      data: records
    });
  } catch (err) {
    console.error('Error fetching event attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to load attendance records.' });
  }
});

/**
 * POST /api/attendance/toggle
 * Protected: Organizers & Admins ONLY
 * Manual adjustment between Present and Registered
 */
router.post('/toggle', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { registrationId, targetStatus } = req.body;

    if (!registrationId) {
      return res.status(400).json({ success: false, message: 'Registration ID is required.' });
    }

    const parsed = parseScannerInput(registrationId);
    const db = getFirestore();

    const allRegs = await db.collection('registrations').get();
    let targetDoc = null;
    let reg = null;

    for (const doc of (allRegs.docs || [])) {
      const r = doc.data();
      const rRoll = (r.rollNumber || r.registerNumber || '').toUpperCase();
      if (r.registrationId === parsed.id || doc.id === parsed.id || (parsed.id && rRoll === parsed.id)) {
        targetDoc = doc.ref || db.collection('registrations').doc(doc.id);
        reg = r;
        break;
      }
    }

    if (!targetDoc || !reg) {
      return res.status(404).json({ success: false, message: 'Registration not found.' });
    }

    // Check Event Ownership
    const eventDoc = await db.collection('events').doc(reg.eventId).get();
    if (eventDoc.exists) {
      const evt = eventDoc.data();
      if (req.user.role !== 'admin' && evt.organizerId && evt.organizerId !== req.user.id && evt.createdBy !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'You Are Not Authorized for This Event'
        });
      }
    }

    const newStatus = targetStatus || (reg.attendanceStatus === 'Present' ? 'Registered' : 'Present');
    const checkInTime = newStatus === 'Present' ? (reg.checkInTime || new Date().toISOString()) : null;

    await targetDoc.update({
      attendanceStatus: newStatus,
      checkInTime
    });

    const attendanceDocId = `att_${reg.eventId}_${reg.registrationId}`;
    if (newStatus === 'Present') {
      await db.collection('attendance').doc(attendanceDocId).set({
        attendanceId: attendanceDocId,
        eventId: reg.eventId,
        registrationId: reg.registrationId,
        studentId: reg.userId || '',
        studentName: reg.studentName,
        rollNumberSnapshot: reg.rollNumber || reg.registerNumber || '',
        organizerId: req.user.id,
        organizerName: req.user.name,
        status: 'Present',
        checkInTime: checkInTime,
        timestamp: checkInTime
      });
    } else {
      await db.collection('attendance').doc(attendanceDocId).delete();
    }

    const updatedStats = await computeEventStats(db, reg.eventId);

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ATTENDANCE_TOGGLED',
      targetType: 'attendance',
      targetId: reg.registrationId,
      details: {
        newStatus,
        eventId: reg.eventId
      }
    });

    // Broadcast status change to SSE subscribers
    broadcastAttendanceEvent({
      type: 'STATUS_TOGGLED',
      eventId: reg.eventId,
      registrationId: reg.registrationId,
      studentName: reg.studentName,
      rollNumber: reg.rollNumber || reg.registerNumber,
      department: reg.department,
      newStatus,
      checkInTime,
      updatedStats
    });

    res.json({
      success: true,
      message: `Status updated to ${newStatus}`,
      data: {
        registrationId: reg.registrationId,
        attendanceStatus: newStatus,
        checkInTime
      },
      stats: updatedStats
    });
  } catch (err) {
    console.error('Error toggling attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle status.' });
  }
});

/**
 * POST /api/attendance/session-mark
 * Protected: Organizers & Admins
 * Marks attendance for a specific session/track (e.g. Forenoon, Afternoon, Day 2)
 */
router.post('/session-mark', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { registrationId, eventId, sessionId } = req.body;

    if (!registrationId || !eventId) {
      return res.status(400).json({ success: false, message: 'Invalid or Expired QR Pass' });
    }

    const cleanSessionId = (sessionId || 'SES-01').trim().toUpperCase();
    const parsed = parseScannerInput(registrationId);
    const db = getFirestore();

    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const currentEvent = eventDoc.data();

    // Check organizer authorization
    if (req.user.role !== 'admin' && currentEvent.organizerId && currentEvent.organizerId !== req.user.id && currentEvent.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You Are Not Authorized for This Event' });
    }

    const found = await findRegistration(db, eventId, parsed);
    if (!found) {
      return res.status(404).json({ success: false, message: 'Registration Not Found' });
    }

    const { docRef, reg } = found;
    if (reg.eventId !== eventId) {
      return res.status(404).json({ success: false, message: 'Registration Not Found' });
    }

    const sessionAttendance = reg.sessionAttendance || {};
    const existingSession = sessionAttendance[cleanSessionId];

    if (existingSession && existingSession.status === 'Present') {
      return res.status(409).json({
        success: false,
        message: `Attendance Already Marked for Session ${cleanSessionId}`,
        student: {
          studentName: reg.studentName,
          rollNumber: reg.rollNumber || reg.registerNumber,
          department: reg.department,
          sessionId: cleanSessionId,
          checkInTime: existingSession.checkInTime
        }
      });
    }

    const checkInTime = new Date().toISOString();
    sessionAttendance[cleanSessionId] = {
      status: 'Present',
      checkInTime,
      markedBy: req.user.id,
      scannerRole: req.user.role
    };

    const attendedCount = Object.values(sessionAttendance).filter(s => s.status === 'Present').length;
    const totalSessions = (currentEvent.sessions && currentEvent.sessions.length > 0) ? currentEvent.sessions.length : 2;

    const updates = {
      sessionAttendance,
      lastCheckInTime: checkInTime,
      updatedAt: checkInTime
    };

    if (attendedCount >= Math.ceil(totalSessions / 2) || reg.attendanceStatus !== 'Present') {
      updates.attendanceStatus = 'Present';
      updates.checkInTime = reg.checkInTime || checkInTime;
    }

    await docRef.update(updates);

    // Save/update attendance record in attendance collection
    const attendanceDocId = `${reg.registrationId}_${cleanSessionId}`;
    await db.collection('attendance').doc(attendanceDocId).set({
      id: attendanceDocId,
      registrationId: reg.registrationId,
      eventId,
      sessionId: cleanSessionId,
      userId: reg.userId,
      studentName: reg.studentName,
      rollNumber: reg.rollNumber || reg.registerNumber,
      status: 'Present',
      checkInTime,
      timestamp: checkInTime
    });

    const updatedStats = await computeEventStats(db, eventId);

    // Broadcast SSE live event
    broadcastAttendanceEvent({
      type: 'SESSION_CHECK_IN',
      eventId,
      eventName: currentEvent.name,
      registrationId: reg.registrationId,
      studentName: reg.studentName,
      rollNumber: reg.rollNumber || reg.registerNumber,
      department: reg.department,
      sessionId: cleanSessionId,
      attendedCount,
      totalSessions,
      checkInTime,
      updatedStats
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'SESSION_ATTENDANCE_MARKED',
      targetType: 'registration',
      targetId: reg.registrationId,
      details: {
        sessionId: cleanSessionId,
        studentName: reg.studentName,
        rollNumber: reg.rollNumber || reg.registerNumber,
        attendedCount,
        totalSessions
      }
    });

    res.json({
      success: true,
      message: `Session ${cleanSessionId} Attendance Marked Successfully`,
      data: {
        registrationId: reg.registrationId,
        sessionId: cleanSessionId,
        studentName: reg.studentName,
        rollNumber: reg.rollNumber || reg.registerNumber,
        overallStatus: updates.attendanceStatus || reg.attendanceStatus,
        attendedCount,
        totalSessions,
        checkInTime
      },
      stats: updatedStats
    });

  } catch (err) {
    console.error('Error marking session attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to record session attendance.' });
  }
});

router.broadcastAttendanceEvent = broadcastAttendanceEvent;
module.exports = router;
