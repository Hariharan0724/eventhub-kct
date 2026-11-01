const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { getFirestore } = require('../firebase');
const { authenticateUser } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');
const { sendPassEmail } = require('../email');

/**
 * Generate a unique sequential Registration ID (e.g., EVT-2026-0006)
 */
async function generateUniqueRegistrationId(db) {
  const currentYear = new Date().getFullYear();
  const prefix = `EVT-${currentYear}-`;

  const allRegsSnapshot = await db.collection('registrations').get();
  const existingDocs = allRegsSnapshot.docs || [];

  let maxNum = 0;
  for (const doc of existingDocs) {
    const regId = doc.id || doc.data().registrationId || '';
    if (regId.startsWith(prefix)) {
      const numPart = parseInt(regId.replace(prefix, ''), 10);
      if (!isNaN(numPart) && numPart > maxNum) {
        maxNum = numPart;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(4, '0');
  const candidateId = `${prefix}${padded}`;

  // Double check uniqueness
  const check = await db.collection('registrations').doc(candidateId).get();
  if (check.exists) {
    return `${prefix}${padded}-${Math.floor(100 + Math.random() * 900)}`;
  }
  return candidateId;
}

/**
 * POST /api/registrations
 * Register an authenticated student for an event
 * Enforces:
 *  - Event must be approved
 *  - Event must not be full
 *  - Student cannot register twice
 *  - Stores student rollNumber snapshot
 */
router.post('/', authenticateUser, async (req, res) => {
  try {
    const {
      eventId,
      studentName,
      email,
      registerNumber,
      rollNumber,
      department,
      year,
      phone
    } = req.body;

    // Use authenticated user identity as authority
    const cleanName = (studentName || req.user.name || '').trim();
    const cleanEmail = (email || req.user.email || '').trim().toLowerCase();
    const cleanRollNo = (rollNumber || req.user.rollNumber || registerNumber || req.user.registerNumber || '').trim().toUpperCase();
    const cleanPhone = (phone || req.user.phone || '').trim();
    const cleanDept = department || req.user.department || 'General Engineering';
    const cleanYear = year || req.user.year || '1st Year';

    // 1. Validate required fields
    if (!eventId || !cleanName || !cleanEmail) {
      return res.status(400).json({
        success: false,
        message: 'Event ID, student name, and email are required.'
      });
    }

    if (!cleanRollNo) {
      return res.status(400).json({
        success: false,
        message: 'Student Roll Number is required for event registration.'
      });
    }

    // 2. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const db = getFirestore();

    // 3. Verify Event exists and is approved and open
    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'The selected event could not be found.'
      });
    }

    const event = eventDoc.data();

    // STRICT CHECK: Event must be approved!
    if (event.approvalStatus && event.approvalStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Registration is not allowed for pending or unapproved events.'
      });
    }

    if (event.status && event.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'Registration for this event is currently closed.'
      });
    }

    // 4. Check Capacity
    const existingForEvent = await db.collection('registrations').where('eventId', '==', eventId).get();
    const currentCount = (existingForEvent.docs || []).length;
    if (event.capacity && currentCount >= event.capacity) {
      return res.status(400).json({
        success: false,
        message: 'Registration is full! All available seats have been booked.'
      });
    }

    // 5. Check for Duplicate Registration (Same userId, rollNumber, or email)
    for (const doc of (existingForEvent.docs || [])) {
      const reg = doc.data();
      if (reg.userId && reg.userId === req.user.id) {
        return res.status(409).json({
          success: false,
          duplicate: true,
          message: 'You have already registered for this event.',
          existingRegistrationId: reg.registrationId
        });
      }
      const existingRoll = (reg.rollNumber || reg.registerNumber || '').toUpperCase();
      if (cleanRollNo && existingRoll === cleanRollNo) {
        return res.status(409).json({
          success: false,
          duplicate: true,
          message: `This student with Roll Number ${cleanRollNo} is already registered for this event.`,
          existingRegistrationId: reg.registrationId
        });
      }
      if (reg.email && reg.email.toLowerCase() === cleanEmail) {
        return res.status(409).json({
          success: false,
          duplicate: true,
          message: `This email address (${cleanEmail}) has already been used to register for this event.`,
          existingRegistrationId: reg.registrationId
        });
      }
    }

    // 6. Generate Unique Registration ID
    const registrationId = await generateUniqueRegistrationId(db);

    // 7. Generate QR Code payload
    // Embed secure token structure containing registration ID and roll number
    const qrPayload = JSON.stringify({
      regId: registrationId,
      eventId: eventId,
      rollNumber: cleanRollNo,
      issuedTo: cleanName
    });

    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(registrationId, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 320,
        color: {
          dark: '#5b21b6', // Theme purple
          light: '#ffffff'
        }
      });
    } catch (qrErr) {
      console.error('Error generating QR code image:', qrErr);
    }

    // 8. Save Registration to Firestore with userId ownership and rollNumber snapshot
    const newRegistration = {
      registrationId,
      userId: req.user.id,
      eventId,
      eventName: event.name,
      studentName: cleanName,
      email: cleanEmail,
      rollNumber: cleanRollNo,
      registerNumber: cleanRollNo, // For backwards compatibility
      department: cleanDept,
      year: cleanYear,
      phone: cleanPhone,
      attendanceStatus: 'Registered',
      checkInTime: null,
      registeredAt: new Date().toISOString(),
      qrCodeData: registrationId,
      qrPayload,
      qrCodeDataUrl
    };

    await db.collection('registrations').doc(registrationId).set(newRegistration);

    // Update event registered count
    try {
      await db.collection('events').doc(eventId).update({
        registeredCount: currentCount + 1
      });
    } catch (e) {}

    // Audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_REGISTERED',
      targetType: 'registration',
      targetId: registrationId,
      details: {
        eventId,
        eventName: event.name,
        rollNumber: cleanRollNo
      }
    });

    // Send Digital QR Pass directly to Student's KCT Email (non-blocking)
    sendPassEmail({
      to: cleanEmail,
      studentName: cleanName,
      rollNumber: cleanRollNo,
      event,
      registrationId,
      qrCodeDataUrl
    }).catch(err => console.error('[Registrations] Email dispatch error:', err));

    return res.status(201).json({
      success: true,
      message: 'Registration confirmed successfully!',
      data: {
        registrationId,
        userId: newRegistration.userId,
        studentName: cleanName,
        email: cleanEmail,
        rollNumber: cleanRollNo,
        registerNumber: cleanRollNo,
        department: cleanDept,
        year: cleanYear,
        phone: cleanPhone,
        eventId,
        eventName: event.name,
        eventDate: event.date,
        eventTime: event.time,
        eventVenue: event.venue,
        registeredAt: newRegistration.registeredAt,
        attendanceStatus: 'Registered',
        qrCodeData: registrationId,
        qrCodeDataUrl
      }
    });

  } catch (err) {
    console.error('Registration processing error:', err);
    return res.status(500).json({
      success: false,
      message: 'Registration failed due to a server error. Please try again.'
    });
  }
});

/**
 * GET /api/registrations/my
 * Protected: Student returns ONLY their own registrations
 */
router.get('/my', authenticateUser, async (req, res) => {
  try {
    const db = getFirestore();
    const allRegs = await db.collection('registrations').get();

    // Filter strictly by authenticated userId or matching student rollNumber/email
    const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();
    const myRegs = (allRegs.docs || [])
      .map(d => d.data())
      .filter(r => {
        const isUserMatch = r.userId === req.user.id;
        const isEmailMatch = req.user.email && r.email && r.email.toLowerCase() === req.user.email.toLowerCase();
        const isRollMatch = userRoll && (r.rollNumber === userRoll || r.registerNumber === userRoll);
        return isUserMatch || isEmailMatch || isRollMatch;
      });

    // Enrich with live event details
    const enriched = await Promise.all(myRegs.map(async reg => {
      const evtDoc = await db.collection('events').doc(reg.eventId).get();
      const evtData = evtDoc.exists ? evtDoc.data() : {};
      return {
        ...reg,
        eventName: evtData.name || reg.eventName || 'Event',
        eventDate: evtData.date || '',
        eventVenue: evtData.venue || '',
        eventTime: evtData.time || '',
        rollNumber: reg.rollNumber || reg.registerNumber || ''
      };
    }));

    return res.json({
      success: true,
      count: enriched.length,
      data: enriched
    });
  } catch (err) {
    console.error('Error fetching student registrations:', err);
    return res.status(500).json({ success: false, message: 'Failed to load your registrations.' });
  }
});

/**
 * GET /api/registrations/search
 * Protected: Search registrations with strict role-based permission boundaries
 */
router.get('/search', authenticateUser, async (req, res) => {
  try {
    const { query, eventId } = req.query;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: 'Search query is required.' });
    }

    const q = query.trim().toUpperCase();
    const db = getFirestore();
    const allRegs = await db.collection('registrations').get();

    let matched = (allRegs.docs || [])
      .map(d => d.data())
      .filter(r => {
        const matchesQuery =
          (r.registrationId && r.registrationId.toUpperCase() === q) ||
          (r.rollNumber && r.rollNumber.toUpperCase() === q) ||
          (r.registerNumber && r.registerNumber.toUpperCase() === q) ||
          (r.email && r.email.toUpperCase() === q);

        if (eventId) {
          return matchesQuery && r.eventId === eventId;
        }
        return matchesQuery;
      });

    // Enforce Role boundaries:
    if (req.user.role === 'student') {
      matched = matched.filter(r => r.userId === req.user.id || r.email === req.user.email);
    } else if (req.user.role === 'organizer') {
      const eventsSnap = await db.collection('events').get();
      const managedEventIds = (eventsSnap.docs || [])
        .map(d => d.data())
        .filter(e => e.organizerId === req.user.id || e.createdBy === req.user.id)
        .map(e => e.id);

      matched = matched.filter(r => managedEventIds.includes(r.eventId));
    }

    if (matched.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No registration found matching the provided details in your authorized scope.'
      });
    }

    const enriched = await Promise.all(matched.map(async reg => {
      const evtDoc = await db.collection('events').doc(reg.eventId).get();
      const evtData = evtDoc.exists ? evtDoc.data() : {};
      return {
        ...reg,
        eventName: evtData.name || reg.eventName || 'Event',
        eventDate: evtData.date || '',
        eventVenue: evtData.venue || '',
        eventTime: evtData.time || '',
        rollNumber: reg.rollNumber || reg.registerNumber || ''
      };
    }));

    return res.json({
      success: true,
      count: enriched.length,
      data: enriched
    });
  } catch (err) {
    console.error('Error searching registrations:', err);
    return res.status(500).json({ success: false, message: 'Search failed.' });
  }
});

/**
 * GET /api/registrations/:id
 * Protected: Retrieve details of a specific registration
 * Checks ownership: Students can ONLY access their own registration.
 */
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const regId = req.params.id.trim();
    const db = getFirestore();
    const docRef = await db.collection('registrations').doc(regId).get();

    if (!docRef.exists) {
      return res.status(404).json({
        success: false,
        message: 'Registration ID not found.'
      });
    }

    const reg = docRef.data();

    // Check ownership boundary
    if (req.user.role === 'student') {
      const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();
      const isOwner = (reg.userId && reg.userId === req.user.id) ||
                      (reg.email === req.user.email) ||
                      (userRoll && (reg.rollNumber === userRoll || reg.registerNumber === userRoll));
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to view another student\'s registration.'
        });
      }
    } else if (req.user.role === 'organizer') {
      const evtDoc = await db.collection('events').doc(reg.eventId).get();
      if (evtDoc.exists) {
        const evt = evtDoc.data();
        if (evt.organizerId && evt.organizerId !== req.user.id && evt.createdBy !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: You are not authorized to view registrations for this event.'
          });
        }
      }
    }

    // Fetch associated event
    const evtDoc = await db.collection('events').doc(reg.eventId).get();
    const event = evtDoc.exists ? evtDoc.data() : {};

    if (!reg.qrCodeDataUrl) {
      try {
        reg.qrCodeDataUrl = await QRCode.toDataURL(reg.registrationId, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 320,
          color: { dark: '#5b21b6', light: '#ffffff' }
        });
      } catch (e) {}
    }

    return res.json({
      success: true,
      data: {
        ...reg,
        rollNumber: reg.rollNumber || reg.registerNumber || '',
        eventName: event.name || reg.eventName || 'Event',
        eventDate: event.date || '',
        eventTime: event.time || '',
        eventVenue: event.venue || '',
        organizer: event.organizer || ''
      }
    });
  } catch (err) {
    console.error('Error fetching registration:', err);
    return res.status(500).json({ success: false, message: 'Unable to load registration details.' });
  }
});

/**
 * GET /api/registrations/:id/qr
 * Protected: Generate QR Code as PNG stream
 */
router.get('/:id/qr', authenticateUser, async (req, res) => {
  try {
    const regId = req.params.id.trim();
    const db = getFirestore();
    const docRef = await db.collection('registrations').doc(regId).get();

    if (!docRef.exists) {
      return res.status(404).send('Registration not found');
    }

    const reg = docRef.data();

    if (req.user.role === 'student') {
      const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();
      const isOwner = (reg.userId && reg.userId === req.user.id) ||
                      (reg.email === req.user.email) ||
                      (userRoll && (reg.rollNumber === userRoll || reg.registerNumber === userRoll));
      if (!isOwner) {
        return res.status(403).send('Forbidden: You can only download your own QR pass');
      }
    }

    res.setHeader('Content-Type', 'image/png');
    QRCode.toFileStream(res, regId, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: { dark: '#5b21b6', light: '#ffffff' }
    });
  } catch (err) {
    res.status(500).send('Error generating QR code image');
  }
});

module.exports = router;
