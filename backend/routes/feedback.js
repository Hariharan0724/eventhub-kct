const express = require('express');
const router = express.Router();
const { getFirestore } = require('../firebase');
const { authenticateUser, requireRole } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');

/**
 * POST /api/feedback/submit
 * Protected: Student (must be verified attendee)
 * Submits ratings (1-5 stars) and review comments for an attended event
 */
router.post('/submit', authenticateUser, async (req, res) => {
  try {
    const { eventId, overallRating, contentRating, organizationRating, wouldRecommend, comments } = req.body;

    if (!eventId) {
      return res.status(400).json({ success: false, message: 'Event ID is required.' });
    }

    const nOverall = Number(overallRating);
    const nContent = Number(contentRating || overallRating);
    const nOrg = Number(organizationRating || overallRating);

    if (!nOverall || nOverall < 1 || nOverall > 5) {
      return res.status(400).json({ success: false, message: 'Overall rating must be an integer between 1 and 5 stars.' });
    }

    const db = getFirestore();

    // 1. Check Event Existence
    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    const event = eventDoc.data();

    // 2. Verify Student Registration and "Present" Attendance
    const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();
    const regsSnap = await db.collection('registrations').where('eventId', '==', eventId).get();
    const myRegDoc = (regsSnap.docs || []).find(d => {
      const r = d.data();
      const rRoll = (r.rollNumber || r.registerNumber || '').toUpperCase();
      return r.userId === req.user.id || (userRoll && rRoll === userRoll) || (req.user.email && r.email && req.user.email.toLowerCase() === r.email.toLowerCase());
    });

    if (!myRegDoc) {
      return res.status(403).json({
        success: false,
        message: 'You must be registered for this event to submit feedback.'
      });
    }

    const myReg = myRegDoc.data();

    if (myReg.attendanceStatus !== 'Present') {
      return res.status(403).json({
        success: false,
        message: 'Feedback is restricted to verified event attendees. Your gate attendance has not been verified.'
      });
    }

    // 3. Prevent duplicate feedback
    const feedbackSnap = await db.collection('feedback').where('eventId', '==', eventId).get();
    const existing = (feedbackSnap.docs || []).find(d => {
      const f = d.data();
      const fRoll = (f.rollNumber || '').toUpperCase();
      return f.studentId === req.user.id || (userRoll && fRoll === userRoll);
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted feedback for this event.'
      });
    }

    // 4. Save Feedback Document
    const feedbackId = `fb_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const studentRoll = userRoll || myReg.rollNumber || myReg.registerNumber || 'KCT';

    const newFeedback = {
      id: feedbackId,
      eventId,
      eventName: event.name,
      registrationId: myReg.registrationId,
      studentId: req.user.id,
      studentName: req.user.name || myReg.studentName || 'Student Attendee',
      rollNumber: studentRoll,
      department: req.user.department || myReg.department || 'CSE',
      overallRating: nOverall,
      contentRating: nContent,
      organizationRating: nOrg,
      wouldRecommend: wouldRecommend !== false,
      comments: (comments || '').trim(),
      submittedAt: new Date().toISOString()
    };

    await db.collection('feedback').doc(feedbackId).set(newFeedback);

    // Audit log
    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'EVENT_FEEDBACK_SUBMITTED',
      targetType: 'event',
      targetId: eventId,
      details: {
        feedbackId,
        rollNumber: studentRoll,
        overallRating: nOverall,
        eventName: event.name
      }
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! Your feedback has been recorded and submitted to the event organizers.',
      data: newFeedback
    });

  } catch (err) {
    console.error('Error submitting feedback:', err);
    res.status(500).json({ success: false, message: 'Failed to record event feedback.' });
  }
});

/**
 * GET /api/feedback/event/:eventId
 * Protected: Organizer & Admin
 * Returns aggregate metrics and participant reviews
 */
router.get('/event/:eventId', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const db = getFirestore();

    const eventDoc = await db.collection('events').doc(eventId).get();
    if (!eventDoc.exists) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const snap = await db.collection('feedback').where('eventId', '==', eventId).get();
    const feedbackList = (snap.docs || []).map(d => d.data());

    if (feedbackList.length === 0) {
      return res.json({
        success: true,
        summary: {
          totalResponses: 0,
          avgOverall: 0,
          avgContent: 0,
          avgOrganization: 0,
          recommendPercentage: 0,
          ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
        },
        reviews: []
      });
    }

    const total = feedbackList.length;
    let sumOverall = 0;
    let sumContent = 0;
    let sumOrg = 0;
    let recommendCount = 0;
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    feedbackList.forEach(fb => {
      sumOverall += fb.overallRating || 5;
      sumContent += fb.contentRating || 5;
      sumOrg += fb.organizationRating || 5;
      if (fb.wouldRecommend) recommendCount++;
      const r = Math.min(5, Math.max(1, Math.round(fb.overallRating || 5)));
      dist[r] = (dist[r] || 0) + 1;
    });

    feedbackList.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    res.json({
      success: true,
      summary: {
        totalResponses: total,
        avgOverall: parseFloat((sumOverall / total).toFixed(1)),
        avgContent: parseFloat((sumContent / total).toFixed(1)),
        avgOrganization: parseFloat((sumOrg / total).toFixed(1)),
        recommendPercentage: Math.round((recommendCount / total) * 100),
        ratingDistribution: dist
      },
      reviews: feedbackList.map(f => ({
        id: f.id,
        studentName: f.studentName,
        rollNumber: f.rollNumber,
        department: f.department,
        overallRating: f.overallRating,
        contentRating: f.contentRating,
        organizationRating: f.organizationRating,
        wouldRecommend: f.wouldRecommend,
        comments: f.comments,
        submittedAt: f.submittedAt
      }))
    });

  } catch (err) {
    console.error('Error fetching event feedback:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve event feedback analytics.' });
  }
});

/**
 * GET /api/feedback/my/:eventId
 * Protected: Student checks their own feedback status
 */
router.get('/my/:eventId', authenticateUser, async (req, res) => {
  try {
    const { eventId } = req.params;
    const db = getFirestore();
    const userRoll = (req.user.rollNumber || req.user.registerNumber || '').toUpperCase();

    const snap = await db.collection('feedback').where('eventId', '==', eventId).get();
    const found = (snap.docs || []).find(d => {
      const f = d.data();
      const fRoll = (f.rollNumber || '').toUpperCase();
      return f.studentId === req.user.id || (userRoll && fRoll === userRoll);
    });

    if (found) {
      return res.json({ success: true, submitted: true, feedback: found.data() });
    }

    res.json({ success: true, submitted: false, feedback: null });

  } catch (err) {
    console.error('Error checking student feedback status:', err);
    res.status(500).json({ success: false, message: 'Failed to check feedback status.' });
  }
});

/**
 * GET /api/feedback/campus-summary
 * Protected: Admin
 * Aggregated campus-wide student satisfaction index across all events
 */
router.get('/campus-summary', authenticateUser, requireRole('admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('feedback').get();
    const all = (snap.docs || []).map(d => d.data());

    if (all.length === 0) {
      return res.json({
        success: true,
        data: {
          totalReviews: 0,
          campusSatisfactionScore: 0,
          recommendationRate: 0,
          eventsReviewed: 0
        }
      });
    }

    const total = all.length;
    const sum = all.reduce((acc, curr) => acc + (curr.overallRating || 5), 0);
    const recs = all.filter(f => f.wouldRecommend).length;
    const uniqueEvents = new Set(all.map(f => f.eventId)).size;

    res.json({
      success: true,
      data: {
        totalReviews: total,
        campusSatisfactionScore: parseFloat((sum / total).toFixed(1)),
        recommendationRate: Math.round((recs / total) * 100),
        eventsReviewed: uniqueEvents
      }
    });

  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load campus feedback summary.' });
  }
});

module.exports = router;
