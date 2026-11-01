const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getFirestore } = require('../firebase');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');
const { broadcastAttendanceEvent } = require('./attendance');

// Enforce admin-only access for all routes in this router
router.use(authenticateUser, requireRole('admin'));

/**
 * GET /api/admin/stats
 * System Overview Dashboard Metrics & Chart Data
 */
router.get('/stats', async (req, res) => {
  try {
    const db = getFirestore();

    const [usersSnap, eventsSnap, regsSnap, attSnap, auditSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('events').get(),
      db.collection('registrations').get(),
      db.collection('attendance').get(),
      db.collection('auditLogs').get()
    ]);

    const users = (usersSnap.docs || []).map(d => d.data());
    const events = (eventsSnap.docs || []).map(d => d.data());
    const registrations = (regsSnap.docs || []).map(d => d.data());
    const attendances = (attSnap.docs || []).map(d => d.data());
    const auditLogs = (auditSnap.docs || []).map(d => d.data());

    const students = users.filter(u => u.role === 'student');
    const organizers = users.filter(u => u.role === 'organizer');

    const totalStudents = students.length;
    const activeStudents = students.filter(s => s.accountStatus !== 'inactive').length;
    const inactiveStudents = totalStudents - activeStudents;

    const totalOrganizers = organizers.length;
    const activeOrganizers = organizers.filter(o => o.accountStatus !== 'inactive').length;

    const totalEvents = events.length;
    const approvedEvents = events.filter(e => (e.approvalStatus || 'approved') === 'approved').length;
    const pendingEvents = events.filter(e => e.approvalStatus === 'pending').length;
    const rejectedEvents = events.filter(e => e.approvalStatus === 'rejected').length;

    const totalRegistrations = registrations.length;
    const totalPresent = attendances.length > 0 ? attendances.length : registrations.filter(r => r.attendanceStatus === 'Present').length;
    const overallAttendanceRate = totalRegistrations > 0
      ? ((totalPresent / totalRegistrations) * 100).toFixed(1)
      : '0.0';

    // Recent 10 audit logs sorted descending
    auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentActivities = auditLogs.slice(0, 10);

    res.json({
      success: true,
      stats: {
        totalStudents,
        activeStudents,
        inactiveStudents,
        totalOrganizers,
        activeOrganizers,
        totalEvents,
        approvedEvents,
        pendingEvents,
        rejectedEvents,
        totalRegistrations,
        totalPresent,
        overallAttendanceRate: parseFloat(overallAttendanceRate)
      },
      chartData: {
        eventStatus: {
          approved: approvedEvents,
          pending: pendingEvents,
          rejected: rejectedEvents
        },
        attendanceRatio: {
          present: totalPresent,
          absent: Math.max(0, totalRegistrations - totalPresent)
        }
      },
      recentActivities
    });
  } catch (err) {
    console.error('Error loading admin stats:', err);
    res.status(500).json({ success: false, message: 'Failed to load system metrics.' });
  }
});

/**
 * GET /api/admin/students
 * List all students with search and filter
 */
router.get('/students', async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('users').get();
    let students = (snap.docs || [])
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === 'student');

    const { search, status, department } = req.query;

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      students = students.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.rollNumber && s.rollNumber.toLowerCase().includes(q)) ||
        (s.registerNumber && s.registerNumber.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'all') {
      students = students.filter(s => (s.accountStatus || 'active') === status);
    }

    if (department && department !== 'all') {
      students = students.filter(s => s.department === department);
    }

    students.sort((a, b) => (a.rollNumber || '').localeCompare(b.rollNumber || ''));

    // Strip password hashes
    const sanitized = students.map(s => {
      const copy = { ...s };
      delete copy.passwordHash;
      return copy;
    });

    res.json({ success: true, count: sanitized.length, data: sanitized });
  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ success: false, message: 'Failed to load students.' });
  }
});

/**
 * POST /api/admin/students
 * Admin creates a new student account
 */
router.post('/students', async (req, res) => {
  try {
    const { name, email, rollNumber, department, year, phone, password } = req.body;

    if (!name || !email || !rollNumber) {
      return res.status(400).json({
        success: false,
        message: 'Name, Email, and College Roll Number are required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRollNo = rollNumber.trim().toUpperCase();

    const db = getFirestore();
    const allUsers = await db.collection('users').get();

    for (const doc of (allUsers.docs || [])) {
      const u = doc.data();
      if (u.email && u.email.toLowerCase() === cleanEmail) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }
      const existingRoll = (u.rollNumber || u.registerNumber || '').toUpperCase();
      if (existingRoll === cleanRollNo) {
        return res.status(409).json({ success: false, message: `Student Roll Number ${cleanRollNo} is already registered.` });
      }
    }

    const userId = `student_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const passwordHash = bcrypt.hashSync(password || 'student@kct2026', 10);

    const newStudent = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      rollNumber: cleanRollNo,
      registerNumber: cleanRollNo,
      department: department || 'Computer Science and Engineering',
      year: year || '1st Year',
      phone: phone || '',
      passwordHash,
      role: 'student',
      accountStatus: 'active',
      createdAt: new Date().toISOString()
    };

    await db.collection('users').doc(userId).set(newStudent);

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'STUDENT_CREATED',
      targetType: 'user',
      targetId: userId,
      details: { rollNumber: cleanRollNo, email: cleanEmail, name: newStudent.name }
    });

    const responseData = { ...newStudent };
    delete responseData.passwordHash;

    res.status(201).json({
      success: true,
      message: 'Student account created successfully!',
      data: responseData
    });
  } catch (err) {
    console.error('Error creating student:', err);
    res.status(500).json({ success: false, message: 'Failed to create student account.' });
  }
});

/**
 * PUT /api/admin/students/:id
 * Edit student details. If rollNumber changed, validates uniqueness and audits change
 */
router.put('/students/:id', async (req, res) => {
  try {
    const studentId = req.params.id;
    const db = getFirestore();
    const docRef = db.collection('users').doc(studentId);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Student account not found.' });
    }

    const currentStudent = existing.data();
    const { name, email, rollNumber, department, year, phone } = req.body;

    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name.trim();
    if (department) updates.department = department;
    if (year) updates.year = year;
    if (phone !== undefined) updates.phone = phone.trim();
    if (req.body.password && req.body.password.trim()) {
      updates.passwordHash = bcrypt.hashSync(req.body.password.trim(), 10);
    }

    // Check email uniqueness if modified
    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail !== (currentStudent.email || '').toLowerCase()) {
        const emailCheck = await db.collection('users').where('email', '==', cleanEmail).get();
        if (emailCheck.docs && emailCheck.docs.length > 0) {
          return res.status(409).json({ success: false, message: 'Another user already has this email address.' });
        }
        updates.email = cleanEmail;
      }
    }

    // Check roll number uniqueness if modified
    let rollChanged = false;
    let oldRoll = currentStudent.rollNumber || currentStudent.registerNumber || '';
    let newRoll = oldRoll;

    if (rollNumber) {
      const cleanRoll = rollNumber.trim().toUpperCase();
      if (cleanRoll !== oldRoll.toUpperCase()) {
        const allUsers = await db.collection('users').get();
        for (const doc of (allUsers.docs || [])) {
          if (doc.id === studentId) continue;
          const u = doc.data();
          const r = (u.rollNumber || u.registerNumber || '').toUpperCase();
          if (r === cleanRoll) {
            return res.status(409).json({
              success: false,
              message: `Roll Number "${cleanRoll}" is already assigned to another student.`
            });
          }
        }
        updates.rollNumber = cleanRoll;
        updates.registerNumber = cleanRoll;
        newRoll = cleanRoll;
        rollChanged = true;
      }
    }

    await docRef.update(updates);

    // If roll number changed, update student registrations & attendance records in background
    if (rollChanged) {
      try {
        const regsSnap = await db.collection('registrations').where('userId', '==', studentId).get();
        for (const regDoc of (regsSnap.docs || [])) {
          const rId = regDoc.id || (typeof regDoc.data === 'function' ? regDoc.data().registrationId : regDoc.registrationId);
          if (rId) {
            await db.collection('registrations').doc(rId).update({
              rollNumber: newRoll,
              registerNumber: newRoll
            });
          }
        }
      } catch (e) {}

      // Log specific ROLL_NUMBER_CHANGED audit
      await recordAuditLog({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'ROLL_NUMBER_CHANGED',
        targetType: 'user',
        targetId: studentId,
        details: {
          studentName: currentStudent.name,
          oldRollNumber: oldRoll,
          newRollNumber: newRoll
        }
      });
    }

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'STUDENT_UPDATED',
      targetType: 'user',
      targetId: studentId,
      details: { updates }
    });

    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();
    delete updatedData.passwordHash;

    res.json({
      success: true,
      message: rollChanged
        ? `Student updated successfully. Roll number modified from ${oldRoll} to ${newRoll}.`
        : 'Student details updated successfully.',
      data: updatedData
    });
  } catch (err) {
    console.error('Error updating student:', err);
    res.status(500).json({ success: false, message: 'Failed to update student details.' });
  }
});

/**
 * PATCH /api/admin/students/:id/status
 * Toggle student account status (active / inactive)
 */
router.patch('/students/:id/status', async (req, res) => {
  try {
    const studentId = req.params.id;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }

    const db = getFirestore();
    const docRef = db.collection('users').doc(studentId);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    await docRef.update({
      accountStatus: status,
      statusUpdatedAt: new Date().toISOString()
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'STUDENT_STATUS_TOGGLED',
      targetType: 'user',
      targetId: studentId,
      details: { newStatus: status }
    });

    res.json({
      success: true,
      message: `Student account ${status === 'active' ? 'activated' : 'deactivated'} successfully.`,
      accountStatus: status
    });
  } catch (err) {
    console.error('Error toggling student status:', err);
    res.status(500).json({ success: false, message: 'Failed to update account status.' });
  }
});

/**
 * GET /api/admin/students/:id/history
 * Get a student's full registration and attendance track record
 */
router.get('/students/:id/history', async (req, res) => {
  try {
    const studentId = req.params.id;
    const db = getFirestore();

    const userDoc = await db.collection('users').doc(studentId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const student = userDoc.data();
    delete student.passwordHash;

    const regsSnap = await db.collection('registrations').get();
    const studentRoll = (student.rollNumber || student.registerNumber || '').toUpperCase();

    const myRegs = (regsSnap.docs || [])
      .map(d => d.data())
      .filter(r => r.userId === studentId || (studentRoll && (r.rollNumber === studentRoll || r.registerNumber === studentRoll)));

    res.json({
      success: true,
      student,
      registrationsCount: myRegs.length,
      attendedCount: myRegs.filter(r => r.attendanceStatus === 'Present').length,
      history: myRegs
    });
  } catch (err) {
    console.error('Error fetching student history:', err);
    res.status(500).json({ success: false, message: 'Failed to load student history.' });
  }
});

/**
 * GET /api/admin/organizers
 * List all organizers
 */
router.get('/organizers', async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('users').get();
    const organizers = (snap.docs || [])
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === 'organizer' || u.role === 'admin')
      .map(o => {
        const copy = { ...o };
        delete copy.passwordHash;
        return copy;
      });

    organizers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json({ success: true, count: organizers.length, data: organizers });
  } catch (err) {
    console.error('Error fetching organizers:', err);
    res.status(500).json({ success: false, message: 'Failed to load organizers.' });
  }
});

/**
 * POST /api/admin/organizers
 * Admin creates an organizer account
 */
router.post('/organizers', async (req, res) => {
  try {
    const { name, email, designation, institution, password } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getFirestore();
    const existing = await db.collection('users').where('email', '==', cleanEmail).get();

    if (existing.docs && existing.docs.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const organizerId = `org_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const passwordHash = bcrypt.hashSync(password || 'admin@kct2026', 10);

    const newOrganizer = {
      id: organizerId,
      name: name.trim(),
      email: cleanEmail,
      designation: designation || 'Event Coordinator',
      institution: institution || 'Kumaraguru College of Technology, Coimbatore',
      role: 'organizer',
      accountStatus: 'active',
      passwordHash,
      createdAt: new Date().toISOString()
    };

    await db.collection('users').doc(organizerId).set(newOrganizer);
    await db.collection('organizers').doc(organizerId).set(newOrganizer);

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ORGANIZER_CREATED',
      targetType: 'user',
      targetId: organizerId,
      details: { name: newOrganizer.name, email: cleanEmail }
    });

    const sanitized = { ...newOrganizer };
    delete sanitized.passwordHash;

    res.status(201).json({
      success: true,
      message: 'Organizer account created successfully!',
      data: sanitized
    });
  } catch (err) {
    console.error('Error creating organizer:', err);
    res.status(500).json({ success: false, message: 'Failed to create organizer account.' });
  }
});

/**
 * PUT /api/admin/organizers/:id
 * Edit organizer account info
 */
router.put('/organizers/:id', async (req, res) => {
  try {
    const organizerId = req.params.id;
    const db = getFirestore();
    const docRef = db.collection('users').doc(organizerId);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Organizer account not found.' });
    }

    const { name, designation, institution, email } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name.trim();
    if (designation) updates.designation = designation.trim();
    if (institution) updates.institution = institution.trim();
    if (req.body.password && req.body.password.trim()) {
      updates.passwordHash = bcrypt.hashSync(req.body.password.trim(), 10);
    }

    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail !== (existing.data().email || '').toLowerCase()) {
        const check = await db.collection('users').where('email', '==', cleanEmail).get();
        if (check.docs && check.docs.length > 0) {
          return res.status(409).json({ success: false, message: 'Email is already used by another account.' });
        }
        updates.email = cleanEmail;
      }
    }

    await docRef.update(updates);
    try {
      await db.collection('organizers').doc(organizerId).update(updates);
    } catch (e) {}

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ORGANIZER_UPDATED',
      targetType: 'user',
      targetId: organizerId,
      details: { updates }
    });

    const updated = await docRef.get();
    const data = updated.data();
    delete data.passwordHash;

    res.json({ success: true, message: 'Organizer details updated successfully.', data });
  } catch (err) {
    console.error('Error updating organizer:', err);
    res.status(500).json({ success: false, message: 'Failed to update organizer.' });
  }
});

/**
 * PATCH /api/admin/organizers/:id/status
 * Toggle organizer account status (active / inactive)
 */
router.patch('/organizers/:id/status', async (req, res) => {
  try {
    const organizerId = req.params.id;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }

    const db = getFirestore();
    const docRef = db.collection('users').doc(organizerId);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Organizer not found.' });
    }

    await docRef.update({ accountStatus: status });
    try {
      await db.collection('organizers').doc(organizerId).update({ accountStatus: status });
    } catch (e) {}

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ORGANIZER_STATUS_TOGGLED',
      targetType: 'user',
      targetId: organizerId,
      details: { newStatus: status }
    });

    res.json({
      success: true,
      message: `Organizer account ${status === 'active' ? 'activated' : 'deactivated'} successfully.`,
      accountStatus: status
    });
  } catch (err) {
    console.error('Error toggling organizer status:', err);
    res.status(500).json({ success: false, message: 'Failed to update organizer status.' });
  }
});

/**
 * GET /api/admin/attendance
 * View all attendance records across all events
 */
router.get('/attendance', async (req, res) => {
  try {
    const db = getFirestore();
    const [attSnap, regsSnap, eventsSnap] = await Promise.all([
      db.collection('attendance').get(),
      db.collection('registrations').get(),
      db.collection('events').get()
    ]);

    const eventsMap = {};
    (eventsSnap.docs || []).forEach(d => {
      const e = d.data();
      eventsMap[e.id] = e.name;
    });

    const attMap = {};
    (attSnap.docs || []).forEach(d => {
      const a = d.data();
      if (a.registrationId) attMap[a.registrationId] = a;
    });

    const regs = (regsSnap.docs || []).map(d => d.data());

    const records = regs.map(r => {
      const regId = r.registrationId || r.id;
      const att = attMap[regId] || {};
      const status = att.status || r.attendanceStatus || 'Registered';
      const time = att.checkInTime || att.timestamp || r.checkInTime || r.registeredAt;
      return {
        id: regId,
        registrationId: regId,
        eventId: r.eventId,
        eventName: r.eventName || eventsMap[r.eventId] || r.eventId,
        studentId: r.userId || '',
        studentName: r.studentName,
        rollNumberSnapshot: r.rollNumber || r.registerNumber || '',
        rollNumber: r.rollNumber || r.registerNumber || '',
        status: status,
        attendanceStatus: status,
        checkInTime: att.checkInTime || r.checkInTime || null,
        timestamp: time,
        correctionReason: r.attendanceCorrectionReason || att.correctionReason || null
      };
    });

    records.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    res.json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (err) {
    console.error('Error fetching admin attendance:', err);
    res.status(500).json({ success: false, message: 'Failed to load attendance records.' });
  }
});

/**
 * POST /api/admin/attendance/correct
 * Admin manual attendance correction with MANDATORY reason requirement
 */
router.post('/attendance/correct', async (req, res) => {
  try {
    const { registrationId, targetStatus, reason } = req.body;

    if (!registrationId) {
      return res.status(400).json({ success: false, message: 'Registration ID is required.' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A mandatory justification reason is required for administrative attendance correction.'
      });
    }

    const cleanReason = reason.trim();
    const db = getFirestore();
    const regDocRef = db.collection('registrations').doc(registrationId);
    const regSnap = await regDocRef.get();

    if (!regSnap.exists) {
      return res.status(404).json({ success: false, message: 'Registration record not found.' });
    }

    const reg = regSnap.data();
    const oldStatus = reg.attendanceStatus || 'Registered';
    const newStatus = targetStatus || (oldStatus === 'Present' ? 'Absent' : 'Present');

    const checkInTime = newStatus === 'Present' ? (reg.checkInTime || new Date().toISOString()) : null;

    // Update registration document
    await regDocRef.update({
      attendanceStatus: newStatus,
      checkInTime,
      attendanceCorrectionReason: cleanReason,
      attendanceCorrectedBy: req.user.id,
      attendanceCorrectedAt: new Date().toISOString()
    });

    // Update attendance collection
    const attendanceDocId = `att_${reg.eventId}_${registrationId}`;
    if (newStatus === 'Present') {
      await db.collection('attendance').doc(attendanceDocId).set({
        attendanceId: attendanceDocId,
        eventId: reg.eventId,
        eventName: reg.eventName || '',
        registrationId,
        studentId: reg.userId || '',
        studentName: reg.studentName,
        rollNumberSnapshot: reg.rollNumber || reg.registerNumber || '',
        organizerId: req.user.id,
        organizerName: req.user.name + ' (Admin Correction)',
        status: 'Present',
        checkInTime: checkInTime,
        timestamp: checkInTime,
        correctionReason: cleanReason
      });
    } else {
      await db.collection('attendance').doc(attendanceDocId).delete();
    }

    // Update event present count
    try {
      const allForEvent = await db.collection('registrations').where('eventId', '==', reg.eventId).get();
      const presentCount = (allForEvent.docs || []).map(d => d.data()).filter(r => r.attendanceStatus === 'Present').length;
      await db.collection('events').doc(reg.eventId).update({ presentCount });
    } catch (e) {}

    // Record audit log with MANDATORY reason
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'ATTENDANCE_CORRECTED',
      targetType: 'attendance',
      targetId: registrationId,
      reason: cleanReason,
      details: {
        eventId: reg.eventId,
        studentName: reg.studentName,
        rollNumber: reg.rollNumber || reg.registerNumber,
        oldStatus,
        newStatus,
        reason: cleanReason
      }
    });

    // Broadcast correction to SSE subscribers
    broadcastAttendanceEvent({
      type: 'ATTENDANCE_CORRECTED',
      eventId: reg.eventId,
      registrationId,
      studentName: reg.studentName,
      rollNumber: reg.rollNumber || reg.registerNumber,
      oldStatus,
      newStatus,
      reason: cleanReason,
      checkInTime
    });

    res.json({
      success: true,
      message: `Attendance corrected to "${newStatus}" successfully. Action has been logged to the audit trail.`,
      data: {
        registrationId,
        oldStatus,
        newStatus,
        reason: cleanReason
      }
    });
  } catch (err) {
    console.error('Error during administrative attendance correction:', err);
    res.status(500).json({ success: false, message: 'Failed to correct attendance.' });
  }
});

/**
 * GET /api/admin/audit-logs
 * View chronological audit logs with optional filtering
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('auditLogs').get();
    let logs = (snap.docs || []).map(d => d.data());

    const { action, actorId, targetType, limit } = req.query;

    if (action && action !== 'all') {
      logs = logs.filter(l => l.action === action);
    }

    if (actorId) {
      logs = logs.filter(l => l.actorId === actorId);
    }

    if (targetType && targetType !== 'all') {
      logs = logs.filter(l => l.targetType === targetType);
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (limit) {
      const n = parseInt(limit, 10);
      if (!isNaN(n) && n > 0) {
        logs = logs.slice(0, n);
      }
    }

    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ success: false, message: 'Failed to load audit logs.' });
  }
});

/**
 * GET /api/admin/emails
 * View recent automated email delivery logs
 */
router.get('/emails', async (req, res) => {
  try {
    const { getSentEmailsLog } = require('../email');
    const limit = parseInt(req.query.limit, 10) || 50;
    const emails = getSentEmailsLog(limit);
    res.json({
      success: true,
      count: emails.length,
      data: emails
    });
  } catch (err) {
    console.error('Error fetching email logs:', err);
    res.status(500).json({ success: false, message: 'Failed to load email delivery logs.' });
  }
});

module.exports = router;
