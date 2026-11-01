const express = require('express');
const router = express.Router();
const { getFirestore } = require('../firebase');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');
const { sendProposalApprovedEmail, sendProposalDeclinedEmail } = require('../email');

/**
 * Helper to compute live registration and attendance stats for an event
 */
async function getEventStats(eventId) {
  const db = getFirestore();
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
    attendanceRate: parseFloat(attendanceRate),
    regs
  };
}

/**
 * GET /api/events
 * Public / Students: Fetch only APPROVED events with live attendance and seat counts
 */
router.get('/', async (req, res) => {
  try {
    const db = getFirestore();
    const eventsSnapshot = await db.collection('events').get();
    const events = [];

    for (const doc of (eventsSnapshot.docs || [])) {
      const evt = doc.data();

      // Only return approved events in public view
      // If legacy event has no approvalStatus, default to 'approved'
      const status = evt.approvalStatus || 'approved';
      if (status !== 'approved') {
        continue;
      }

      const stats = await getEventStats(evt.id);

      events.push({
        ...evt,
        approvalStatus: status,
        registeredCount: stats.totalRegistered,
        presentCount: stats.totalPresent,
        absentCount: stats.totalAbsent,
        attendanceRate: stats.attendanceRate,
        availableSeats: Math.max(0, (evt.capacity || 100) - stats.totalRegistered)
      });
    }

    // Sort by date ascending
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ success: false, message: 'Unable to load events. Please try again later.' });
  }
});

/**
 * GET /api/events/all
 * Protected: Organizers and Admins ONLY
 * Returns all events regardless of approval status (pending, approved, rejected)
 */
router.get('/all', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventsSnapshot = await db.collection('events').get();
    const events = [];

    for (const doc of (eventsSnapshot.docs || [])) {
      const evt = doc.data();
      const stats = await getEventStats(evt.id);

      events.push({
        ...evt,
        approvalStatus: evt.approvalStatus || 'approved',
        registeredCount: stats.totalRegistered,
        presentCount: stats.totalPresent,
        absentCount: stats.totalAbsent,
        attendanceRate: stats.attendanceRate,
        availableSeats: Math.max(0, (evt.capacity || 100) - stats.totalRegistered)
      });
    }

    // Sort by createdAt or date descending
    events.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

    res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    console.error('Error fetching all events for organizer/admin:', err);
    res.status(500).json({ success: false, message: 'Unable to load all events.' });
  }
});

/**
 * GET /api/events/my-submissions
 * Protected: Authenticated Students and Organizers
 * Returns events created/submitted by the logged-in user
 */
router.get('/my-submissions', authenticateUser, async (req, res) => {
  try {
    const db = getFirestore();
    const eventsSnapshot = await db.collection('events').get();
    const myEvents = [];

    for (const doc of (eventsSnapshot.docs || [])) {
      const evt = doc.data();
      if (evt.createdBy === req.user.id || evt.organizerId === req.user.id) {
        const stats = await getEventStats(evt.id);
        myEvents.push({
          ...evt,
          approvalStatus: evt.approvalStatus || 'approved',
          registeredCount: stats.totalRegistered,
          presentCount: stats.totalPresent,
          absentCount: stats.totalAbsent,
          attendanceRate: stats.attendanceRate,
          availableSeats: Math.max(0, (evt.capacity || 100) - stats.totalRegistered)
        });
      }
    }

    myEvents.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));

    res.json({ success: true, count: myEvents.length, data: myEvents });
  } catch (err) {
    console.error('Error fetching my event submissions:', err);
    res.status(500).json({ success: false, message: 'Unable to load your event submissions.' });
  }
});

/**
 * GET /api/events/:id
 * Public: Fetch single event details
 */
router.get('/:id', async (req, res) => {
  try {
    const db = getFirestore();
    const docRef = await db.collection('events').doc(req.params.id).get();

    if (!docRef.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const evt = docRef.data();
    const stats = await getEventStats(evt.id);

    res.json({
      success: true,
      data: {
        ...evt,
        approvalStatus: evt.approvalStatus || 'approved',
        registeredCount: stats.totalRegistered,
        presentCount: stats.totalPresent,
        absentCount: stats.totalAbsent,
        attendanceRate: stats.attendanceRate,
        remainingSeats: Math.max(0, (evt.capacity || 100) - stats.totalRegistered)
      }
    });
  } catch (err) {
    console.error('Error fetching event details:', err);
    res.status(500).json({ success: false, message: 'Unable to load event details.' });
  }
});

/**
 * POST /api/events
 * Protected: Students, Organizers, and Admins
 * Students & Organizers submit with approvalStatus = 'pending'
 * Admins create with approvalStatus = 'approved'
 */
router.post('/', authenticateUser, requireRole('student', 'organizer', 'admin'), async (req, res) => {
  try {
    const { name, category, date, time, venue, organizer, capacity, registrationDeadline, image, description, rules } = req.body;

    if (!name || !date || !venue) {
      return res.status(400).json({ success: false, message: 'Event name, date, and venue are required.' });
    }

    const db = getFirestore();
    const eventId = 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    // Initial approval status: Admins get 'approved' immediately; students and organizers get 'pending'
    const approvalStatus = req.user.role === 'admin' ? 'approved' : 'pending';

    const newEvent = {
      id: eventId,
      createdBy: req.user.id,
      createdByRole: req.user.role,
      createdByName: req.user.name || 'EventHub User',
      organizerId: req.user.role === 'organizer' ? req.user.id : (req.body.organizerId || 'kct_organizer_1'),
      name: name.trim(),
      category: category || 'Technical',
      date,
      time: time || '09:30 AM - 04:30 PM',
      venue: venue.trim(),
      organizer: organizer || req.user.name || 'KCT Student Affairs',
      capacity: parseInt(capacity, 10) || 100,
      registeredCount: 0,
      presentCount: 0,
      registrationDeadline: registrationDeadline || `${date}T23:59:59`,
      image: image || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80',
      description: description || 'KCT Student Event for technical enrichment and collaborative skill development.',
      rules: rules || '1. Valid College ID Card required.\n2. EventHub Digital QR Code must be shown at the entrance.',
      status: 'open',
      approvalStatus,
      createdAt: new Date().toISOString()
    };

    await db.collection('events').doc(eventId).set(newEvent);

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_SUBMITTED',
      targetType: 'event',
      targetId: eventId,
      details: {
        eventName: newEvent.name,
        approvalStatus,
        category: newEvent.category
      }
    });

    const userMessage = approvalStatus === 'approved'
      ? 'Event created and published successfully!'
      : 'Event submitted successfully! It is now pending review and approval by an authorized organizer or admin.';

    res.status(201).json({
      success: true,
      message: userMessage,
      data: newEvent
    });
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ success: false, message: 'Failed to create event. Please try again.' });
  }
});

/**
 * POST /api/events/:id/approve
 * Protected: Organizers and Admins ONLY
 * RULE: Event creator CANNOT evaluate or approve their own event!
 */
router.post('/:id/approve', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const docRef = db.collection('events').doc(req.params.id);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = existing.data();

    // STRICT RULE: Creator CANNOT approve their own event
    if (event.createdBy === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot approve your own event submission. Evaluation must be performed by another authorized organizer or administrator.'
      });
    }

    const approvedAt = new Date().toISOString();
    await docRef.update({
      approvalStatus: 'approved',
      approvedBy: req.user.id,
      approvedByName: req.user.name,
      approvedByRole: req.user.role,
      approvedAt,
      rejectionReason: null
    });

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_APPROVED',
      targetType: 'event',
      targetId: event.id,
      details: {
        eventName: event.name,
        createdBy: event.createdBy
      }
    });

    // Send approval notification email to creator (non-blocking)
    (async () => {
      try {
        let recipientEmail = null;
        let creatorName = event.createdByName || 'Student Organizer';
        if (event.createdBy) {
          const creatorDoc = await db.collection('users').doc(event.createdBy).get();
          if (creatorDoc.exists) {
            recipientEmail = creatorDoc.data().email;
            creatorName = creatorDoc.data().name || creatorName;
          }
        }
        if (recipientEmail) {
          await sendProposalApprovedEmail({
            to: recipientEmail,
            creatorName,
            eventName: event.name,
            approvedByName: req.user.name || 'Authorized Evaluator',
            eventId: event.id
          });
        }
      } catch (e) {
        console.error('[Events] Error sending proposal approved email:', e);
      }
    })();

    res.json({
      success: true,
      message: `Event "${event.name}" approved successfully and is now active for student registration!`,
      data: {
        id: event.id,
        approvalStatus: 'approved',
        approvedAt
      }
    });
  } catch (err) {
    console.error('Error approving event:', err);
    res.status(500).json({ success: false, message: 'Failed to approve event.' });
  }
});

/**
 * POST /api/events/:id/reject
 * Protected: Organizers and Admins ONLY
 * RULE: Event creator CANNOT evaluate or reject their own event!
 * RULE: Rejection reason is MANDATORY!
 */
router.post('/:id/reject', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A rejection reason is mandatory when declining an event submission.'
      });
    }

    const db = getFirestore();
    const docRef = db.collection('events').doc(req.params.id);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = existing.data();

    // STRICT RULE: Creator CANNOT evaluate their own event
    if (event.createdBy === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot evaluate or reject your own event submission.'
      });
    }

    const rejectedAt = new Date().toISOString();
    const cleanReason = rejectionReason.trim();

    await docRef.update({
      approvalStatus: 'rejected',
      rejectedBy: req.user.id,
      rejectedByName: req.user.name,
      rejectedByRole: req.user.role,
      rejectionReason: cleanReason,
      rejectedAt
    });

    // Record audit log with mandatory reason
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_REJECTED',
      targetType: 'event',
      targetId: event.id,
      reason: cleanReason,
      details: {
        eventName: event.name,
        createdBy: event.createdBy
      }
    });

    // Send decline notification email to creator with mandatory reason (non-blocking)
    (async () => {
      try {
        let recipientEmail = null;
        let creatorName = event.createdByName || 'Student Organizer';
        if (event.createdBy) {
          const creatorDoc = await db.collection('users').doc(event.createdBy).get();
          if (creatorDoc.exists) {
            recipientEmail = creatorDoc.data().email;
            creatorName = creatorDoc.data().name || creatorName;
          }
        }
        if (recipientEmail) {
          await sendProposalDeclinedEmail({
            to: recipientEmail,
            creatorName,
            eventName: event.name,
            declinedByName: req.user.name || 'Event Evaluator',
            rejectionReason: cleanReason,
            eventId: event.id
          });
        }
      } catch (e) {
        console.error('[Events] Error sending proposal decline email:', e);
      }
    })();

    res.json({
      success: true,
      message: `Event "${event.name}" has been rejected.`,
      data: {
        id: event.id,
        approvalStatus: 'rejected',
        rejectionReason: cleanReason,
        rejectedAt
      }
    });
  } catch (err) {
    console.error('Error rejecting event:', err);
    res.status(500).json({ success: false, message: 'Failed to reject event.' });
  }
});

/**
 * PUT /api/events/:id
 * Protected: Creator or Admin
 * Allows creator to edit details (or resubmit rejected event back to 'pending')
 */
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const db = getFirestore();
    const docRef = db.collection('events').doc(req.params.id);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = existing.data();

    // Check ownership: only creator or admin can edit
    const isCreator = event.createdBy === req.user.id || event.organizerId === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to edit this event.'
      });
    }

    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    delete updates.id;
    delete updates.createdBy;

    // If event was rejected and creator edits it, reset to pending
    if (event.approvalStatus === 'rejected' && !isAdmin) {
      updates.approvalStatus = 'pending';
      updates.rejectionReason = null;
    }

    await docRef.update(updates);
    const updated = await docRef.get();

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_UPDATED',
      targetType: 'event',
      targetId: event.id,
      details: { updates }
    });

    res.json({ success: true, message: 'Event updated successfully!', data: updated.data() });
  } catch (err) {
    console.error('Error updating event:', err);
    res.status(500).json({ success: false, message: 'Failed to update event.' });
  }
});

/**
 * DELETE /api/events/:id
 * Protected: Creator or Admin
 */
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const db = getFirestore();
    const docRef = db.collection('events').doc(req.params.id);
    const existing = await docRef.get();

    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = existing.data();
    const isCreator = event.createdBy === req.user.id || event.organizerId === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to delete this event.'
      });
    }

    await docRef.delete();

    // Record audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_DELETED',
      targetType: 'event',
      targetId: event.id,
      details: { eventName: event.name }
    });

    res.json({ success: true, message: 'Event deleted successfully.' });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
});

/**
 * GET /api/events/:id/participants
 * Protected: Organizers and Admins ONLY
 * Checks ownership
 */
router.get('/:id/participants', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();

    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = eventDoc.data();

    // Check ownership
    if (req.user.role !== 'admin' && event.organizerId && event.organizerId !== req.user.id && event.createdBy !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to view participants for this event.'
      });
    }

    const { search, department, status, sortBy, order } = req.query;
    const regsSnapshot = await db.collection('registrations').where('eventId', '==', req.params.id).get();
    let participants = (regsSnapshot.docs || []).map(d => d.data());

    // Search filter
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      participants = participants.filter(p =>
        (p.studentName && p.studentName.toLowerCase().includes(q)) ||
        (p.registerNumber && p.registerNumber.toLowerCase().includes(q)) ||
        (p.rollNumber && p.rollNumber.toLowerCase().includes(q)) ||
        (p.registrationId && p.registrationId.toLowerCase().includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q))
      );
    }

    // Department filter
    if (department && department !== 'all') {
      participants = participants.filter(p => p.department === department);
    }

    // Status filter
    if (status && status !== 'all') {
      if (status === 'Present') {
        participants = participants.filter(p => p.attendanceStatus === 'Present');
      } else if (status === 'Absent' || status === 'Registered') {
        participants = participants.filter(p => p.attendanceStatus !== 'Present');
      }
    }

    // Sorting
    const sortField = sortBy || 'registeredAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    participants.sort((a, b) => {
      const valA = a[sortField] || '';
      const valB = b[sortField] || '';
      if (valA < valB) return -1 * sortOrder;
      if (valA > valB) return 1 * sortOrder;
      return 0;
    });

    const stats = await getEventStats(event.id);

    res.json({
      success: true,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue
      },
      stats: {
        totalRegistered: stats.totalRegistered,
        totalPresent: stats.totalPresent,
        totalAbsent: stats.totalAbsent,
        attendanceRate: stats.attendanceRate
      },
      count: participants.length,
      data: participants
    });
  } catch (err) {
    console.error('Error fetching participants:', err);
    res.status(500).json({ success: false, message: 'Unable to load participants.' });
  }
});

/**
 * GET /api/events/:id/attendance
 * Protected: Organizers and Admins ONLY
 * Checks ownership
 */
router.get('/:id/attendance', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();

    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = eventDoc.data();

    if (req.user.role !== 'admin' && event.organizerId && event.organizerId !== req.user.id && event.createdBy !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not authorized to view attendance statistics for this event.'
      });
    }

    const stats = await getEventStats(event.id);

    res.json({
      success: true,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        time: event.time,
        venue: event.venue,
        capacity: event.capacity
      },
      attendance: {
        registered: stats.totalRegistered,
        present: stats.totalPresent,
        absent: stats.totalAbsent,
        attendancePercentage: stats.attendanceRate
      }
    });
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ success: false, message: 'Unable to load attendance details.' });
  }
});

/**
 * GET /api/events/:id/export-csv
 * Protected: Organizers and Admins ONLY
 */
router.get('/:id/export-csv', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();

    if (!eventDoc.exists) {
      return res.status(404).send('Event not found.');
    }

    const event = eventDoc.data();

    if (req.user.role !== 'admin' && event.organizerId && event.organizerId !== req.user.id && event.createdBy !== req.user.id) {
      return res.status(403).send('Forbidden: You are not authorized to export reports for this event.');
    }

    const stats = await getEventStats(event.id);
    const regs = stats.regs;

    // Build CSV
    const csvRows = [];
    csvRows.push('EventHub - KCT Digital Event Attendance Report');
    csvRows.push(`Event Name,${JSON.stringify(event.name)}`);
    csvRows.push(`Date,${event.date}`);
    csvRows.push(`Venue,${JSON.stringify(event.venue)}`);
    csvRows.push(`Total Registered,${stats.totalRegistered}`);
    csvRows.push(`Total Present,${stats.totalPresent}`);
    csvRows.push(`Total Absent,${stats.totalAbsent}`);
    csvRows.push(`Attendance Rate,${stats.attendanceRate}%`);
    csvRows.push('');
    csvRows.push('Registration ID,Student Name,Roll Number,Department,Year,Email,Phone,Attendance Status,Check-in Time');

    for (const r of regs) {
      const checkInFormatted = r.checkInTime ? new Date(r.checkInTime).toLocaleString() : 'Not Checked-in';
      const studentRoll = r.rollNumber || r.registerNumber || '';
      csvRows.push([
        r.registrationId,
        `"${(r.studentName || '').replace(/"/g, '""')}"`,
        studentRoll,
        `"${(r.department || '').replace(/"/g, '""')}"`,
        r.year,
        r.email,
        r.phone,
        r.attendanceStatus === 'Present' ? 'Present' : 'Absent',
        `"${checkInFormatted}"`
      ].join(','));
    }

    const csvContent = csvRows.join('\r\n');
    const filename = `EventHub_${event.name.replace(/[^a-zA-Z0-9]/g, '_')}_Attendance.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    res.status(500).send('Error generating CSV export.');
  }
});

/**
 * GET /api/events/:id/academic-roster
 * Protected: Organizers & Admins
 * Returns institutional academic attendance roster with official sign-off metadata
 */
router.get('/:id/academic-roster', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();

    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const event = eventDoc.data();

    if (req.user.role !== 'admin' && event.organizerId && event.organizerId !== req.user.id && event.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized to access academic roster for this event.' });
    }

    const stats = await getEventStats(event.id);
    const regs = stats.regs || [];

    // Sort alphabetically by Roll Number
    regs.sort((a, b) => (a.rollNumber || a.registerNumber || '').localeCompare(b.rollNumber || b.registerNumber || ''));

    const roster = regs.map((r, idx) => ({
      sNo: idx + 1,
      registrationId: r.registrationId,
      rollNumber: r.rollNumber || r.registerNumber || 'N/A',
      studentName: r.studentName,
      department: r.department,
      year: r.year,
      email: r.email,
      phone: r.phone,
      attendanceStatus: r.attendanceStatus === 'Present' ? 'Present' : 'Absent',
      checkInTime: r.checkInTime ? new Date(r.checkInTime).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
      }) : '—'
    }));

    res.json({
      success: true,
      data: {
        institution: 'Kumaraguru College of Technology (KCT), Coimbatore',
        accreditation: 'Autonomous Institution Affiliated to Anna University &bull; Approved by AICTE',
        generatedAt: new Date().toISOString(),
        event: {
          id: event.id,
          name: event.name,
          category: event.category,
          date: event.date,
          time: event.time,
          venue: event.venue,
          organizer: event.organizer || 'KCT Department',
          capacity: event.capacity
        },
        stats: {
          totalRegistered: stats.totalRegistered,
          totalPresent: stats.totalPresent,
          totalAbsent: stats.totalAbsent,
          attendanceRate: stats.attendanceRate
        },
        roster,
        signatories: {
          facultyCoordinator: 'Faculty Event Coordinator',
          hod: 'Head of Department (HOD)',
          academicDean: 'Dean / Controller of Academic Clearance'
        }
      }
    });
  } catch (err) {
    console.error('Error generating academic roster:', err);
    res.status(500).json({ success: false, message: 'Failed to generate academic roster.' });
  }
});

/**
 * GET /api/events/:id/sessions
 * List all sessions/tracks configured for this event
 */
router.get('/:id/sessions', async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const event = eventDoc.data();

    // If event has custom sessions, return them
    if (event.sessions && Array.isArray(event.sessions) && event.sessions.length > 0) {
      return res.json({ success: true, eventId: event.id, sessions: event.sessions });
    }

    // Default 2 standard collegiate tracks (Forenoon & Afternoon)
    const defaultSessions = [
      {
        sessionId: 'SES-01',
        name: 'Forenoon Session (Keynote & Core Concepts)',
        date: event.date || '2026-03-15',
        time: '09:30 AM - 12:30 PM',
        mandatory: true
      },
      {
        sessionId: 'SES-02',
        name: 'Afternoon Session (Practical Lab & Hack Track)',
        date: event.date || '2026-03-15',
        time: '01:30 PM - 04:30 PM',
        mandatory: true
      }
    ];

    res.json({ success: true, eventId: event.id, sessions: defaultSessions, isDefault: true });
  } catch (err) {
    console.error('Error fetching event sessions:', err);
    res.status(500).json({ success: false, message: 'Failed to load event sessions.' });
  }
});

/**
 * POST /api/events/:id/sessions
 * Protected: Organizer & Admin
 * Configures or updates multi-day / multi-session tracks for an event
 */
router.post('/:id/sessions', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const docRef = db.collection('events').doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const event = existing.data();

    // Check ownership
    if (req.user.role !== 'admin' && event.organizerId && event.organizerId !== req.user.id && event.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized to configure sessions for this event.' });
    }

    const { sessions } = req.body;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ success: false, message: 'Sessions must be a non-empty array.' });
    }

    const cleanSessions = sessions.map((s, idx) => ({
      sessionId: (s.sessionId || `SES-${String(idx + 1).padStart(2, '0')}`).trim().toUpperCase(),
      name: (s.name || `Session ${idx + 1}`).trim(),
      date: s.date || event.date || '2026-03-15',
      time: s.time || '09:30 AM - 12:30 PM',
      mandatory: s.mandatory !== false
    }));

    await docRef.update({
      sessions: cleanSessions,
      isMultiSession: true,
      sessionsUpdatedAt: new Date().toISOString()
    });

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_SESSIONS_CONFIGURED',
      targetType: 'event',
      targetId: event.id,
      details: { sessionCount: cleanSessions.length, sessions: cleanSessions }
    });

    res.json({
      success: true,
      message: `${cleanSessions.length} sessions configured successfully.`,
      sessions: cleanSessions
    });
  } catch (err) {
    console.error('Error configuring sessions:', err);
    res.status(500).json({ success: false, message: 'Failed to configure sessions.' });
  }
});

/**
 * GET /api/events/:id/session-matrix
 * Protected: Organizer & Admin
 * Returns multi-session attendance progress matrix for all attendees
 */
router.get('/:id/session-matrix', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const eventDoc = await db.collection('events').doc(req.params.id).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const event = eventDoc.data();

    const sessions = (event.sessions && event.sessions.length > 0) ? event.sessions : [
      { sessionId: 'SES-01', name: 'Forenoon Track', mandatory: true },
      { sessionId: 'SES-02', name: 'Afternoon Track', mandatory: true }
    ];

    const regsSnap = await db.collection('registrations').where('eventId', '==', req.params.id).get();
    const regs = (regsSnap.docs || []).map(d => d.data());
    regs.sort((a, b) => (a.rollNumber || a.registerNumber || '').localeCompare(b.rollNumber || b.registerNumber || ''));

    const totalSessions = sessions.length;

    const matrix = regs.map(r => {
      const sa = r.sessionAttendance || {};
      let attendedCount = 0;
      const sessionMap = {};

      sessions.forEach(s => {
        const check = sa[s.sessionId];
        const isAttended = (check && check.status === 'Present') || (r.attendanceStatus === 'Present' && Object.keys(sa).length === 0);
        if (isAttended) attendedCount++;
        sessionMap[s.sessionId] = {
          attended: !!isAttended,
          markedAt: check ? check.checkInTime : (isAttended ? r.checkInTime : null)
        };
      });

      const percentage = Math.round((attendedCount / totalSessions) * 100);
      const isCleared = attendedCount >= Math.ceil(totalSessions / 2) || r.attendanceStatus === 'Present';

      return {
        registrationId: r.registrationId,
        studentName: r.studentName,
        rollNumber: r.rollNumber || r.registerNumber || 'N/A',
        department: r.department || 'CSE',
        overallStatus: isCleared ? 'Present' : (r.attendanceStatus || 'Registered'),
        attendedCount,
        totalSessions,
        attendancePercentage: percentage,
        sessions: sessionMap
      };
    });

    res.json({
      success: true,
      event: { id: event.id, name: event.name, date: event.date },
      sessions,
      matrix
    });
  } catch (err) {
    console.error('Error fetching session matrix:', err);
    res.status(500).json({ success: false, message: 'Failed to load session matrix.' });
  }
});

module.exports = router;
