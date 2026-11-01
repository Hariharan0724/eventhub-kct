const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { getFirestore } = require('../firebase');
const { authenticateUser } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');

/**
 * Helper to generate deterministic Certificate ID
 */
function getCertificateId(registrationId) {
  const cleanId = String(registrationId).trim().toUpperCase();
  return `KCT-CERT-${cleanId}`;
}

/**
 * GET /api/certificates/:registrationId
 * Protected: Student (owner), Organizer, or Admin
 * Generates and returns a tamper-proof certificate for a verified attendee.
 */
router.get('/:registrationId', authenticateUser, async (req, res) => {
  try {
    const { registrationId } = req.params;
    if (!registrationId) {
      return res.status(400).json({
        success: false,
        message: 'Registration ID is required'
      });
    }

    const db = getFirestore();
    const cleanRegId = registrationId.trim().toUpperCase();

    // 1. Fetch Registration
    const regDoc = await db.collection('registrations').doc(cleanRegId).get();
    if (!regDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Registration record not found'
      });
    }

    const reg = regDoc.data();

    // 2. Ownership & Permission Boundary
    const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();
    const isOwner = reg.userId === req.user.id || 
                    (userRoll && (reg.rollNumber === userRoll || reg.registerNumber === userRoll)) ||
                    (req.user.email && reg.email && req.user.email.toLowerCase() === reg.email.toLowerCase());

    const isStaff = req.user.role === 'admin' || req.user.role === 'organizer';

    if (!isOwner && !isStaff) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to student certificate'
      });
    }

    // 3. Strict Verification Check: Attendance MUST be marked Present
    if (reg.attendanceStatus !== 'Present') {
      return res.status(403).json({
        success: false,
        message: 'Attendance must be verified to issue certificate. Student has not checked in to this event.'
      });
    }

    // 4. Fetch Event details
    let eventName = reg.eventName || 'Campus Event';
    let eventDate = '2026';
    let eventVenue = 'Kumaraguru College of Technology, Coimbatore';
    let organizerName = 'Department Faculty & Student Coordinators';
    let category = 'Academic / Technical';

    if (reg.eventId) {
      const evtDoc = await db.collection('events').doc(reg.eventId).get();
      if (evtDoc.exists) {
        const evt = evtDoc.data();
        eventName = evt.name || eventName;
        eventDate = evt.date || eventDate;
        eventVenue = evt.venue || eventVenue;
        organizerName = evt.organizer || evt.createdByName || organizerName;
        category = evt.category || category;
      }
    }

    const certId = getCertificateId(cleanRegId);
    const host = req.get('host') || 'localhost:5000';
    const protocol = req.protocol || 'http';
    const verificationUrl = `${protocol}://${host}/verify-certificate.html?certId=${certId}`;

    // 5. Generate high-resolution Verification QR Code
    let verificationQrUrl = '';
    try {
      verificationQrUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 250,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } catch (qrErr) {
      console.error('[Certificate] QR generation error:', qrErr);
    }

    // 6. Build Certificate Payload
    const certificateData = {
      certificateId: certId,
      registrationId: cleanRegId,
      studentName: reg.studentName,
      rollNumber: reg.rollNumber || reg.registerNumber || '',
      department: reg.department || 'Engineering',
      institution: 'Kumaraguru College of Technology (KCT), Coimbatore',
      eventId: reg.eventId,
      eventName,
      eventDate,
      eventVenue,
      category,
      organizerName,
      issuedAt: new Date().toISOString(),
      verifiedCheckInTime: reg.checkInTime || reg.registeredAt,
      verificationUrl,
      verificationQrUrl,
      signatures: {
        coordinator: 'Faculty Event Coordinator',
        principal: 'Principal / Head of Institution'
      }
    };

    // 7. Persist or Update in Certificates Collection
    await db.collection('certificates').doc(certId).set(certificateData);

    // 8. Immutable Audit Log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'CERTIFICATE_ISSUED',
      targetType: 'certificate',
      targetId: certId,
      details: {
        registrationId: cleanRegId,
        studentName: reg.studentName,
        rollNumber: certificateData.rollNumber,
        eventId: reg.eventId,
        eventName
      }
    });

    return res.json({
      success: true,
      data: certificateData
    });

  } catch (err) {
    console.error('Error generating certificate:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate certificate'
    });
  }
});

/**
 * GET /api/certificates/verify/:certId
 * Public endpoint: Allows any third party to verify certificate authenticity.
 */
router.get('/verify/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    if (!certId) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: 'Certificate ID is required'
      });
    }

    const cleanCertId = certId.trim().toUpperCase();
    const db = getFirestore();

    const certDoc = await db.collection('certificates').doc(cleanCertId).get();
    if (!certDoc.exists) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: 'Certificate record not found or invalid'
      });
    }

    const cert = certDoc.data();

    return res.json({
      success: true,
      verified: true,
      data: {
        certificateId: cert.certificateId,
        studentName: cert.studentName,
        rollNumber: cert.rollNumber,
        department: cert.department,
        institution: cert.institution,
        eventName: cert.eventName,
        eventDate: cert.eventDate,
        eventVenue: cert.eventVenue,
        category: cert.category,
        issuedAt: cert.issuedAt,
        verifiedCheckInTime: cert.verifiedCheckInTime,
        status: 'Officially Verified & Authentic'
      }
    });

  } catch (err) {
    console.error('Error verifying certificate:', err);
    return res.status(500).json({
      success: false,
      verified: false,
      message: 'Server error during certificate verification'
    });
  }
});

module.exports = router;
