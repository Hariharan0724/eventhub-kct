const express = require('express');
const router = express.Router();
const { getFirestore } = require('../firebase');
const { authenticateUser, requireRole } = require('../middleware/auth');

/**
 * GET /api/dashboard/stats
 * Protected: Organizers & Admins ONLY
 * Returns aggregate metrics for events managed by the authenticated organizer
 */
router.get('/stats', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();

    // 1. Fetch events
    const eventsSnap = await db.collection('events').get();
    let events = (eventsSnap.docs || []).map(d => d.data());

    // Filter by organizer ownership (unless admin)
    if (req.user.role !== 'admin') {
      events = events.filter(evt => evt.organizerId === req.user.id);
    }

    const eventIds = events.map(e => e.id);

    // 2. Fetch registrations for authorized events
    const regsSnap = await db.collection('registrations').get();
    const allRegs = (regsSnap.docs || [])
      .map(d => d.data())
      .filter(r => eventIds.includes(r.eventId));

    const totalEvents = events.length;
    const totalRegistrations = allRegs.length;
    const totalPresent = allRegs.filter(r => r.attendanceStatus === 'Present').length;
    const totalAbsent = totalRegistrations - totalPresent;
    const overallAttendanceRate = totalRegistrations > 0 
      ? ((totalPresent / totalRegistrations) * 100).toFixed(1) 
      : '0.0';

    // 3. Compute per-event breakdown
    const eventBreakdown = events.map(evt => {
      const evtRegs = allRegs.filter(r => r.eventId === evt.id);
      const regCount = evtRegs.length;
      const presCount = evtRegs.filter(r => r.attendanceStatus === 'Present').length;
      const absCount = regCount - presCount;
      const rate = regCount > 0 ? ((presCount / regCount) * 100).toFixed(1) : '0.0';

      return {
        id: evt.id,
        name: evt.name,
        category: evt.category,
        date: evt.date,
        time: evt.time,
        venue: evt.venue,
        capacity: evt.capacity,
        registered: regCount,
        present: presCount,
        absent: absCount,
        attendanceRate: parseFloat(rate),
        status: evt.status || 'open'
      };
    });

    // 4. Recent check-ins list for authorized events
    const recentCheckIns = allRegs
      .filter(r => r.attendanceStatus === 'Present' && r.checkInTime)
      .sort((a, b) => new Date(b.checkInTime) - new Date(a.checkInTime))
      .slice(0, 8)
      .map(r => ({
        registrationId: r.registrationId,
        studentName: r.studentName,
        registerNumber: r.registerNumber,
        department: r.department,
        eventName: r.eventName,
        checkInTime: r.checkInTime
      }));

    res.json({
      success: true,
      stats: {
        totalEvents,
        totalRegistrations,
        totalPresent,
        totalAbsent,
        attendanceRate: parseFloat(overallAttendanceRate)
      },
      events: eventBreakdown,
      recentCheckIns
    });
  } catch (err) {
    console.error('Error computing dashboard statistics:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard metrics.'
    });
  }
});

/**
 * GET /api/dashboard/student-stats
 * Protected: Students & Admins ONLY
 * Returns personal event attendance statistics and registration history for the logged-in student
 */
router.get('/student-stats', authenticateUser, requireRole('student', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();
    const regsSnap = await db.collection('registrations').get();

    // Filter registrations strictly by current student
    const studentRegs = (regsSnap.docs || [])
      .map(d => d.data())
      .filter(r => r.userId === req.user.id || (req.user.email && r.email === req.user.email));

    const totalRegistered = studentRegs.length;
    const totalAttended = studentRegs.filter(r => r.attendanceStatus === 'Present').length;
    const pendingCheckIn = totalRegistered - totalAttended;
    const attendancePercentage = totalRegistered > 0
      ? ((totalAttended / totalRegistered) * 100).toFixed(1)
      : '0.0';

    // Enrich registrations with live event details
    const enriched = await Promise.all(studentRegs.map(async reg => {
      const evtDoc = await db.collection('events').doc(reg.eventId).get();
      const evtData = evtDoc.exists ? evtDoc.data() : {};
      return {
        ...reg,
        eventName: evtData.name || reg.eventName || 'Event',
        eventDate: evtData.date || '',
        eventVenue: evtData.venue || '',
        eventTime: evtData.time || '',
        category: evtData.category || 'General'
      };
    }));

    // Sort by event date descending
    enriched.sort((a, b) => new Date(b.eventDate || b.registeredAt) - new Date(a.eventDate || a.registeredAt));

    res.json({
      success: true,
      stats: {
        totalRegistered,
        totalAttended,
        pendingCheckIn,
        attendancePercentage: parseFloat(attendancePercentage)
      },
      registrations: enriched
    });
  } catch (err) {
    console.error('Error fetching student stats:', err);
    res.status(500).json({ success: false, message: 'Failed to load student dashboard statistics.' });
  }
});

/**
 * GET /api/dashboard/analytics
 * Protected: Organizers & Admins
 * Aggregates attendance metrics broken down by Department and Academic Year
 */
router.get('/analytics', authenticateUser, requireRole('organizer', 'admin'), async (req, res) => {
  try {
    const db = getFirestore();

    const [eventsSnap, regsSnap] = await Promise.all([
      db.collection('events').get(),
      db.collection('registrations').get()
    ]);

    let events = (eventsSnap.docs || []).map(d => d.data());
    let regs = (regsSnap.docs || []).map(d => d.data());

    // If organizer, filter to their managed events
    if (req.user.role !== 'admin') {
      const managedIds = events.filter(e => e.organizerId === req.user.id || e.createdBy === req.user.id).map(e => e.id);
      regs = regs.filter(r => managedIds.includes(r.eventId));
    }

    // 1. Department Breakdown
    const deptMap = {};
    for (const r of regs) {
      let dept = (r.department || 'General Engineering').trim();
      // Normalize department names
      if (/information\s*tech/i.test(dept) || dept === 'IT') dept = 'Information Technology';
      else if (/computer\s*sci/i.test(dept) || dept === 'CSE') dept = 'Computer Science & Engineering';
      else if (/electrical|electronics/i.test(dept) && /comm/i.test(dept)) dept = 'Electronics & Communication';
      else if (/mech/i.test(dept)) dept = 'Mechanical Engineering';
      else if (/civil/i.test(dept)) dept = 'Civil Engineering';
      else if (/ai|data\s*sci/i.test(dept)) dept = 'AI & Data Science';

      if (!deptMap[dept]) {
        deptMap[dept] = { department: dept, totalRegistered: 0, totalPresent: 0 };
      }
      deptMap[dept].totalRegistered += 1;
      if (r.attendanceStatus === 'Present') {
        deptMap[dept].totalPresent += 1;
      }
    }

    const departmentBreakdown = Object.values(deptMap).map(d => {
      const absent = d.totalRegistered - d.totalPresent;
      const rate = d.totalRegistered > 0 ? ((d.totalPresent / d.totalRegistered) * 100).toFixed(1) : '0.0';
      return {
        ...d,
        totalAbsent: absent,
        attendanceRate: parseFloat(rate)
      };
    });

    departmentBreakdown.sort((a, b) => b.totalPresent - a.totalPresent || b.totalRegistered - a.totalRegistered);

    // 2. Academic Year Breakdown
    const standardYears = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
    const yearMap = {};
    for (const y of standardYears) {
      yearMap[y] = { year: y, totalRegistered: 0, totalPresent: 0 };
    }

    for (const r of regs) {
      let yr = (r.year || '1st Year').trim();
      if (!yearMap[yr]) {
        if (/1/i.test(yr)) yr = '1st Year';
        else if (/2/i.test(yr)) yr = '2nd Year';
        else if (/3/i.test(yr)) yr = '3rd Year';
        else if (/4/i.test(yr)) yr = '4th Year';
        else yr = '1st Year';
      }
      yearMap[yr].totalRegistered += 1;
      if (r.attendanceStatus === 'Present') {
        yearMap[yr].totalPresent += 1;
      }
    }

    const yearBreakdown = Object.values(yearMap).map(y => {
      const absent = y.totalRegistered - y.totalPresent;
      const rate = y.totalRegistered > 0 ? ((y.totalPresent / y.totalRegistered) * 100).toFixed(1) : '0.0';
      return {
        ...y,
        totalAbsent: absent,
        attendanceRate: parseFloat(rate)
      };
    });

    // 3. Summary
    const totalRegistered = regs.length;
    const totalPresent = regs.filter(r => r.attendanceStatus === 'Present').length;
    const totalAbsent = totalRegistered - totalPresent;
    const overallRate = totalRegistered > 0 ? ((totalPresent / totalRegistered) * 100).toFixed(1) : '0.0';

    const topDept = departmentBreakdown.length > 0 ? departmentBreakdown[0].department : 'General Engineering';
    const topYear = [...yearBreakdown].sort((a, b) => b.totalPresent - a.totalPresent)[0]?.year || '3rd Year';

    res.json({
      success: true,
      data: {
        summary: {
          totalRegistered,
          totalPresent,
          totalAbsent,
          overallRate: parseFloat(overallRate),
          topDepartment: topDept,
          topYear: topYear
        },
        departmentBreakdown,
        yearBreakdown
      }
    });

  } catch (err) {
    console.error('Error computing analytics:', err);
    res.status(500).json({ success: false, message: 'Failed to compute attendance analytics.' });
  }
});

module.exports = router;
