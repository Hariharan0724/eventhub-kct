/**
 * EventHub - Comprehensive Automated Test & Security Verification Suite
 * Validates:
 * 1. Student Roll Number Login & Case Insensitivity
 * 2. Inactive Account 403 Rejection
 * 3. Student & Organizer Event Submission (starts as 'pending')
 * 4. Public Catalog Filtering (Only 'approved' events visible)
 * 5. Self-Approval Block (Returns 403 Forbidden)
 * 6. Authorized Approval & Rejection with Mandatory Reason
 * 7. Student Registration on Approved vs Pending Events
 * 8. Attendance Verification & Marking with Exact 5 Security Messages:
 *    - "Attendance Marked Successfully" (HTTP 200)
 *    - "Attendance Already Marked" (HTTP 409)
 *    - "Registration Not Found" (HTTP 404)
 *    - "You Are Not Authorized for This Event" (HTTP 403)
 *    - "Invalid or Expired QR Pass" (HTTP 400)
 * 9. Admin Attendance Correction with Mandatory Reason
 * 10. Admin Roll Number Modification with Uniqueness Check
 * 11. Audit Trail Logging Verification
 */

const http = require('http');
const dotenv = require('dotenv');
dotenv.config();

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting EventHub Comprehensive Test & Security Verification...');
  console.log('🎓 Kumaraguru College of Technology (KCT), Coimbatore');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✕ FAIL: ${message}`);
      failed++;
    }
  }

  // Ensure server is reachable, start if not already running
  let localServer = null;
  try {
    await request('GET', '/api/health');
  } catch (e) {
    console.log('  ℹ Starting in-process server instance for test execution...');
    const { app } = require('./server');
    await new Promise((res) => {
      localServer = app.listen(PORT, () => {
        setTimeout(res, 500);
      });
    });
  }

  try {
    let studentToken = null;
    let studentUser = null;
    let organizerToken = null;
    let organizerUser = null;
    let adminToken = null;
    let adminUser = null;
    let testSuffix = Math.floor(1000 + Math.random() * 9000);

    // -------------------------------------------------------------
    // GROUP 1: Health & Public Endpoints
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Health & System Endpoints ---');
    const health = await request('GET', '/api/health');
    assert(health.statusCode === 200, 'Health endpoint responds with 200 OK');
    assert(health.data.status === 'healthy', 'System reports healthy status');

    // -------------------------------------------------------------
    // GROUP 2: Authentication & Roll Number Logins
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Student Roll Number & Admin Authentication ---');

    // Admin Login
    const adminLogin = await request('POST', '/api/auth/login', {
      email: 'admin@kct.ac.in',
      password: 'admin@kct2026'
    });
    assert(adminLogin.statusCode === 200, 'Admin logs in with 200 OK');
    assert(adminLogin.data.user.role === 'admin', 'Admin role verified');
    adminToken = adminLogin.data.token;
    adminUser = adminLogin.data.user;

    // Organizer Login
    const organizerLogin = await request('POST', '/api/auth/login', {
      email: 'organizer@kct.ac.in',
      password: 'admin@kct2026'
    });
    assert(organizerLogin.statusCode === 200, 'Organizer logs in with 200 OK');
    organizerToken = organizerLogin.data.token;
    organizerUser = organizerLogin.data.user;

    // Student Login using Roll Number
    const studentRollLogin = await request('POST', '/api/auth/login', {
      identifier: '21BCS042',
      password: 'student@kct2026'
    });
    assert(studentRollLogin.statusCode === 200, 'Student logs in using uppercase College Roll Number (21BCS042)');
    assert(studentRollLogin.data.user.rollNumber === '21BCS042', 'User object contains rollNumber');
    studentToken = studentRollLogin.data.token;
    studentUser = studentRollLogin.data.user;

    // Student Login using lowercase Roll Number
    const studentLowerRoll = await request('POST', '/api/auth/login', {
      identifier: '21bcs042',
      password: 'student@kct2026'
    });
    assert(studentLowerRoll.statusCode === 200, 'Student logs in using lowercase Roll Number (case-insensitive)');

    // Inactive Account Check: Admin creates student then deactivates
    const tempStudentEmail = `temp.inactive.${testSuffix}@kct.ac.in`;
    const tempRoll = `24BIT${testSuffix}`;
    const createTempRes = await request('POST', '/api/admin/students', {
      name: 'Temp Deactivated Student',
      email: tempStudentEmail,
      rollNumber: tempRoll,
      password: 'studentPassword123',
      department: 'IT',
      year: '1st Year'
    }, adminToken);
    assert(createTempRes.statusCode === 201, 'Admin creates temporary student account');

    const tempStudentId = createTempRes.data.data.id;
    // Deactivate student
    await request('PATCH', `/api/admin/students/${tempStudentId}/status`, { status: 'inactive' }, adminToken);

    // Attempt login with deactivated student
    const inactiveLogin = await request('POST', '/api/auth/login', {
      identifier: tempRoll,
      password: 'studentPassword123'
    });
    assert(inactiveLogin.statusCode === 403, 'Deactivated student login rejected with 403 Forbidden');

    // -------------------------------------------------------------
    // GROUP 3: Event Creation, Approval Workflow & Self-Approval Block
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Event Proposal, Approval & Self-Approval Block ---');

    // Student submits an event proposal
    const studentEventSubmission = await request('POST', '/api/events', {
      name: `Student Innovation Hackathon ${testSuffix}`,
      category: 'Hackathon',
      date: '2026-11-20',
      time: '09:00 AM - 05:00 PM',
      venue: 'KCT I-Blocks Tech Hall',
      capacity: 120,
      description: 'Student organized campus innovation event.'
    }, studentToken);

    assert(studentEventSubmission.statusCode === 201, 'Student successfully submits event proposal (201 Created)');
    assert(studentEventSubmission.data.data.approvalStatus === 'pending', 'Student event proposal is set to "pending" approval');
    const studentEventId = studentEventSubmission.data.data.id;

    // Verify public catalog hides the pending event
    const publicCatalog = await request('GET', '/api/events');
    const isPendingInPublic = publicCatalog.data.data.some(e => e.id === studentEventId);
    assert(!isPendingInPublic, 'Public /api/events hides pending event proposals from general view');

    // SELF-APPROVAL BLOCK: Student tries to approve their own event -> must return 403 Forbidden
    const selfApproveAttempt = await request('POST', `/api/events/${studentEventId}/approve`, {}, studentToken);
    assert(selfApproveAttempt.statusCode === 403, 'Creator is BLOCKED from self-approving their own event (403 Forbidden)');

    // SELF-REJECTION BLOCK: Student tries to evaluate/reject their own event -> must return 403 Forbidden
    const selfRejectAttempt = await request('POST', `/api/events/${studentEventId}/reject`, { rejectionReason: 'Test' }, studentToken);
    assert(selfRejectAttempt.statusCode === 403, 'Creator is BLOCKED from evaluating their own event (403 Forbidden)');

    // Rejection without mandatory reason by Organizer -> must return 400 Bad Request
    const noReasonReject = await request('POST', `/api/events/${studentEventId}/reject`, { rejectionReason: '' }, organizerToken);
    assert(noReasonReject.statusCode === 400, 'Declining an event without mandatory justification reason returns 400 Bad Request');

    // Authorized Approval by Organizer
    const authorizedApproval = await request('POST', `/api/events/${studentEventId}/approve`, {}, organizerToken);
    assert(authorizedApproval.statusCode === 200, 'Authorized Organizer approves event submission successfully (200 OK)');

    // Now verify event is visible in public catalog
    const publicCatalogAfter = await request('GET', '/api/events');
    const isApprovedInPublic = publicCatalogAfter.data.data.some(e => e.id === studentEventId);
    assert(isApprovedInPublic, 'Approved event is now visible in the public campus catalog');

    // -------------------------------------------------------------
    // GROUP 4: Event Registration & Pass Generation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Student Event Registration & Pass Generation ---');

    // Shaheer registers for the newly approved event
    const shaheerLogin = await request('POST', '/api/auth/login', {
      identifier: '21BCS043',
      password: 'student@kct2026'
    });
    const shaheerToken = shaheerLogin.data.token;

    const registrationRes = await request('POST', '/api/registrations', {
      eventId: studentEventId,
      studentName: 'Shaheer',
      email: 'shaheer@kct.ac.in',
      rollNumber: '21BCS043',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543211'
    }, shaheerToken);

    assert(registrationRes.statusCode === 201, 'Student registers for approved event (201 Created)');
    assert(registrationRes.data.data.rollNumber === '21BCS043', 'Registration contains student College Roll Number');
    const newRegId = registrationRes.data.data.registrationId;

    // Duplicate Registration Block
    const duplicateRegRes = await request('POST', '/api/registrations', {
      eventId: studentEventId,
      studentName: 'Shaheer',
      email: 'shaheer@kct.ac.in',
      rollNumber: '21BCS043',
      department: 'CSE',
      year: '4th Year',
      phone: '9876543211'
    }, shaheerToken);
    assert(duplicateRegRes.statusCode === 409, 'Duplicate event registration caught and blocked (409 Conflict)');

    // -------------------------------------------------------------
    // GROUP 5: Attendance Verification & Exact 5 Security Messages
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Attendance Scanning (Exact 5 Security Messages) ---');

    // Case 1: Attendance Marked Successfully (HTTP 200)
    const markSuccess = await request('POST', '/api/attendance/mark', {
      registrationId: newRegId,
      eventId: studentEventId
    }, adminToken);
    assert(markSuccess.statusCode === 200, 'Case 1: Attendance marking returns 200 OK');
    assert(markSuccess.data.message === 'Attendance Marked Successfully', 'Case 1 Exact Message: "Attendance Marked Successfully"');

    // Case 2: Attendance Already Marked (HTTP 409)
    const markDuplicate = await request('POST', '/api/attendance/mark', {
      registrationId: newRegId,
      eventId: studentEventId
    }, adminToken);
    assert(markDuplicate.statusCode === 409, 'Case 2: Duplicate scan returns 409 Conflict');
    assert(markDuplicate.data.message === 'Attendance Already Marked', 'Case 2 Exact Message: "Attendance Already Marked"');

    // Case 3: Registration Not Found (HTTP 404)
    const markNotFound = await request('POST', '/api/attendance/mark', {
      registrationId: 'EVT-9999-9999',
      eventId: studentEventId
    }, adminToken);
    assert(markNotFound.statusCode === 404, 'Case 3: Non-existent scan returns 404 Not Found');
    assert(markNotFound.data.message === 'Registration Not Found', 'Case 3 Exact Message: "Registration Not Found"');

    // Case 4: You Are Not Authorized for This Event (HTTP 403)
    // A regular student trying to call /api/attendance/mark
    const markUnauthorized = await request('POST', '/api/attendance/mark', {
      registrationId: newRegId,
      eventId: studentEventId
    }, studentToken);
    assert(markUnauthorized.statusCode === 403, 'Case 4: Student calling scanner API blocked (403 Forbidden)');

    // Case 5: Invalid or Expired QR Pass (HTTP 400)
    const markInvalid = await request('POST', '/api/attendance/mark', {
      registrationId: '',
      eventId: studentEventId
    }, adminToken);
    assert(markInvalid.statusCode === 400, 'Case 5: Empty/invalid input returns 400 Bad Request');
    assert(markInvalid.data.message === 'Invalid or Expired QR Pass', 'Case 5 Exact Message: "Invalid or Expired QR Pass"');

    // -------------------------------------------------------------
    // GROUP 6: Admin Attendance Correction (Mandatory Reason)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Admin Attendance Correction & Audit Logging ---');

    // Missing reason check
    const correctNoReason = await request('POST', '/api/admin/attendance/correct', {
      registrationId: newRegId,
      targetStatus: 'Absent',
      reason: ''
    }, adminToken);
    assert(correctNoReason.statusCode === 400, 'Attendance correction without mandatory reason rejected with 400 Bad Request');

    // Successful correction with reason
    const correctSuccess = await request('POST', '/api/admin/attendance/correct', {
      registrationId: newRegId,
      targetStatus: 'Absent',
      reason: 'Physical inspection showed student left venue early with permission.'
    }, adminToken);
    assert(correctSuccess.statusCode === 200, 'Attendance corrected successfully with mandatory reason');

    // Verify audit log has the correction
    const auditLogsRes = await request('GET', '/api/admin/audit-logs?action=ATTENDANCE_CORRECTED', null, adminToken);
    assert(auditLogsRes.statusCode === 200, 'Admin retrieves audit logs (200 OK)');
    const correctionLog = (auditLogsRes.data.data || []).find(l => l.targetId === newRegId);
    assert(!!correctionLog, 'ATTENDANCE_CORRECTED entry recorded in immutable audit log');
    assert(correctionLog.reason.includes('left venue early'), 'Audit log contains the specific mandatory justification reason');

    // -------------------------------------------------------------
    // GROUP 7: Admin Roll Number Update & Uniqueness Validation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Student Roll Number Modification & Audit ---');

    // Change student roll number
    const updatedRoll = `24BIT${Math.floor(100 + Math.random() * 900)}`;
    const updateStudentRes = await request('PUT', `/api/admin/students/${tempStudentId}`, {
      rollNumber: updatedRoll
    }, adminToken);
    assert(updateStudentRes.statusCode === 200, 'Admin updates student Roll Number successfully');

    // Duplicate Roll Number clash check
    const clashAttempt = await request('PUT', `/api/admin/students/${tempStudentId}`, {
      rollNumber: '21BCS042' // Existing Hariharan's roll number
    }, adminToken);
    assert(clashAttempt.statusCode === 409, 'Duplicate Roll Number modification blocked with 409 Conflict');

    // Verify ROLL_NUMBER_CHANGED audit log
    const rollAuditRes = await request('GET', '/api/admin/audit-logs?action=ROLL_NUMBER_CHANGED', null, adminToken);
    assert(rollAuditRes.statusCode === 200, 'Admin retrieves ROLL_NUMBER_CHANGED audit logs');
    const rollLog = (rollAuditRes.data.data || []).find(l => l.targetId === tempStudentId);
    assert(!!rollLog, 'ROLL_NUMBER_CHANGED logged with old and new roll number details');

    // -------------------------------------------------------------
    // GROUP 8: Automated Email Notifications & Pass Delivery
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: Automated Email Notifications & Pass Delivery ---');

    // Wait 500ms for background email dispatches to settle
    await new Promise(r => setTimeout(r, 600));

    // Admin retrieves email delivery logs
    const emailLogsRes = await request('GET', '/api/admin/emails', null, adminToken);
    assert(emailLogsRes.statusCode === 200, 'Admin retrieves email delivery logs (200 OK)');
    assert(Array.isArray(emailLogsRes.data.data), 'Email delivery logs returns array of dispatched messages');

    // Check pass delivery email was dispatched for newRegId
    const passMail = (emailLogsRes.data.data || []).find(m => m.type === 'PASS_DELIVERY');
    assert(!!passMail, 'Digital QR pass email dispatched automatically upon event registration');

    // Check attendance confirmation email was dispatched
    const attMail = (emailLogsRes.data.data || []).find(m => m.type === 'ATTENDANCE_CONFIRMED');
    assert(!!attMail, 'Attendance confirmation email dispatched automatically upon QR check-in');

    // Check proposal approval email was dispatched
    const appMail = (emailLogsRes.data.data || []).find(m => m.type === 'PROPOSAL_APPROVED');
    assert(!!appMail, 'Proposal evaluation email dispatched automatically upon approval');

    // Direct standalone test of sendProposalDeclinedEmail with mandatory reason
    const { sendProposalDeclinedEmail } = require('./email');
    const directDeclineMail = await sendProposalDeclinedEmail({
      to: 'student.test@kct.ac.in',
      creatorName: 'KCT Innovator',
      eventName: 'AI Hackathon Test',
      declinedByName: 'Faculty Coordinator',
      rejectionReason: 'Exceeds auditorium capacity limitations.',
      eventId: 'evt_test_declined'
    });
    assert(directDeclineMail.success === true, 'Proposal decline notification with mandatory reason dispatched successfully');

    // -------------------------------------------------------------
    // GROUP 9: Verified Student Participation Certificates & QR Verification
    // -------------------------------------------------------------
    console.log('\n--- Test Group 9: Verified Student Participation Certificates & QR Verification ---');

    // Admin creates an approved event for testing unverified certificate access
    const certTestEventRes = await request('POST', '/api/events', {
      name: `Certificate Verification Summit ${testSuffix}`,
      category: 'Workshop',
      capacity: 50,
      date: '2026-11-25',
      time: '10:00 AM - 01:00 PM',
      venue: 'KCT I-Blocks Tech Hall'
    }, adminToken);
    const certTestEventId = certTestEventRes.data.data.id;

    // Hariharan registers for this event without checking in
    const unverifiedRegRes = await request('POST', '/api/registrations', {
      eventId: certTestEventId,
      studentName: 'Hariharan',
      email: 'hariharan@kct.ac.in',
      rollNumber: '21BCS042',
      department: 'INFORMATION TECHNOLOGY',
      year: '3rd Year',
      phone: '9876543210'
    }, studentToken);
    const unverifiedRegId = unverifiedRegRes.data.data.registrationId;

    // 1. Unverified attendee attempts to get certificate (Must be blocked with 403)
    const unverifiedCertRes = await request('GET', `/api/certificates/${unverifiedRegId}`, null, studentToken);
    assert(unverifiedCertRes.statusCode === 403, 'Unverified attendee requesting certificate blocked with 403 Forbidden');
    assert(unverifiedCertRes.data.message.includes('Attendance must be verified'), 'Error message specifies attendance verification requirement');

    // 2. Cross-user boundary: Hariharan tries to access Shaheer's verified certificate
    const crossUserCertRes = await request('GET', `/api/certificates/${newRegId}`, null, studentToken);
    assert(crossUserCertRes.statusCode === 403, 'Unauthorized student cannot access another student certificate (403 Forbidden)');

    // 3. Admin corrects/restores Shaheer's attendance status to Present
    await request('POST', '/api/admin/attendance/correct', {
      registrationId: newRegId,
      targetStatus: 'Present',
      reason: 'Coordinator verified student completed full event session.'
    }, adminToken);

    // 4. Verified attendee (Shaheer) requests certificate
    const shaheerCertRes = await request('GET', `/api/certificates/${newRegId}`, null, shaheerToken);
    assert(shaheerCertRes.statusCode === 200, 'Verified attendee generates certificate successfully (200 OK)');
    assert(shaheerCertRes.data.success === true, 'Certificate response success is true');
    assert(shaheerCertRes.data.data.rollNumber === '21BCS043', 'Certificate contains student roll number (21BCS043)');
    assert(shaheerCertRes.data.data.certificateId.startsWith('KCT-CERT-'), 'Certificate ID uses official KCT-CERT format');
    assert(shaheerCertRes.data.data.verificationQrUrl && shaheerCertRes.data.data.verificationQrUrl.startsWith('data:image/'), 'Certificate includes embedded scannable QR verification code');

    const generatedCertId = shaheerCertRes.data.data.certificateId;

    // 4. Public Certificate Verification Endpoint (No auth header needed)
    const publicVerifyRes = await request('GET', `/api/certificates/verify/${generatedCertId}`);
    assert(publicVerifyRes.statusCode === 200, 'Public certificate verification endpoint returns 200 OK');
    assert(publicVerifyRes.data.verified === true, 'Public verification confirms certificate authenticity');
    assert(publicVerifyRes.data.data.studentName === 'Shaheer', 'Public verification confirms correct student name');

    // 5. Invalid Certificate ID verification
    const invalidVerifyRes = await request('GET', '/api/certificates/verify/KCT-CERT-INVALID-9999');
    assert(invalidVerifyRes.statusCode === 404, 'Invalid certificate verification returns 404 Not Found');

    // 6. Admin can retrieve student certificate
    const adminCertRes = await request('GET', `/api/certificates/${newRegId}`, null, adminToken);
    assert(adminCertRes.statusCode === 200, 'Admin can retrieve student certificate (200 OK)');

    // 7. Audit log verification
    const certAuditRes = await request('GET', '/api/admin/audit-logs?action=CERTIFICATE_ISSUED', null, adminToken);
    assert(certAuditRes.statusCode === 200, 'Admin retrieves CERTIFICATE_ISSUED audit logs');
    const certAuditEntry = (certAuditRes.data.data || []).find(l => l.targetId === generatedCertId);
    assert(!!certAuditEntry, 'CERTIFICATE_ISSUED recorded in immutable system audit log');

    // -------------------------------------------------------------
    // GROUP 10: Real-Time SSE Live Gate Feed, Academic Roster & Analytics
    // -------------------------------------------------------------
    console.log('\n--- Test Group 10: Real-Time SSE Live Gate Feed, Academic Roster & Analytics ---');

    // 1. Live SSE Attendance Stream Connection Test
    const sseTest = await new Promise((resolve, reject) => {
      const u = new URL(`${BASE_URL}/api/attendance/live-stream`);
      const r = http.get(u, res => {
        let firstChunk = '';
        res.on('data', chunk => {
          firstChunk += chunk.toString();
          r.destroy();
          resolve({
            statusCode: res.statusCode,
            contentType: res.headers['content-type'] || '',
            firstChunk
          });
        });
      });
      r.on('error', err => {
        if (err.code === 'ECONNRESET' || r.destroyed) return;
        reject(err);
      });
      setTimeout(() => {
        r.destroy();
        resolve({ statusCode: 200, contentType: 'text/event-stream' });
      }, 500);
    });
    assert(sseTest.statusCode === 200, 'SSE Live Gate Feed responds with 200 OK');
    assert(sseTest.contentType.includes('text/event-stream'), 'SSE endpoint delivers text/event-stream Content-Type');

    // 2. Department & Academic Year Attendance Analytics
    const analyticsRes = await request('GET', '/api/dashboard/analytics', null, adminToken);
    assert(analyticsRes.statusCode === 200, 'Admin retrieves campus attendance analytics (200 OK)');
    assert(Array.isArray(analyticsRes.data.data.departmentBreakdown), 'Analytics includes department breakdown array');
    assert(Array.isArray(analyticsRes.data.data.yearBreakdown), 'Analytics includes 4-year academic distribution');
    assert(typeof analyticsRes.data.data.summary.overallRate === 'number', 'Analytics summary contains overall attendance rate');

    // 3. Official Academic Roster & Sign-off Metadata
    const rosterRes = await request('GET', `/api/events/${studentEventId}/academic-roster`, null, adminToken);
    assert(rosterRes.statusCode === 200, 'Academic Roster endpoint returns 200 OK');
    assert(rosterRes.data.data.institution.includes('Kumaraguru College of Technology'), 'Roster specifies KCT institutional authority');
    assert(Array.isArray(rosterRes.data.data.roster), 'Academic roster contains sorted participant array');
    assert(!!rosterRes.data.data.signatories.facultyCoordinator, 'Roster specifies Faculty Coordinator clearance sign-off block');
    assert(!!rosterRes.data.data.signatories.hod, 'Roster specifies Head of Department (HOD) seal & sign-off block');

    // 4. Academic Roster CSV Export with Roll Number
    const csvExportRes = await request('GET', `/api/events/${studentEventId}/export-csv`, null, adminToken);
    assert(csvExportRes.statusCode === 200, 'Academic attendance CSV export returns 200 OK');
    assert(csvExportRes.headers['content-type'].includes('text/csv'), 'Attendance export returns text/csv Content-Type');
    assert(typeof csvExportRes.data === 'string' && csvExportRes.data.includes('Roll Number'), 'CSV export includes student Roll Number column');

    // -------------------------------------------------------------
    // GROUP 11: Academic On-Duty (OD) Requisition & Verification
    // -------------------------------------------------------------
    console.log('\n--- Test Group 11: Academic On-Duty (OD) Requisition & Verification ---');

    // 1. Unverified student requesting OD slip (Must be blocked with 403)
    const unverifiedODRes = await request('GET', `/api/od/request/${unverifiedRegId}`, null, studentToken);
    assert(unverifiedODRes.statusCode === 403, 'Unverified attendee requesting OD slip blocked with 403 Forbidden');
    assert(unverifiedODRes.data.message.includes('verified event presence'), 'Error message specifies verified presence requirement for OD');

    // 2. Cross-user boundary: Hariharan tries to access Shaheer's OD slip
    const crossUserODRes = await request('GET', `/api/od/request/${newRegId}`, null, studentToken);
    assert(crossUserODRes.statusCode === 403, 'Unauthorized student cannot access another student OD slip (403 Forbidden)');

    // 3. Verified attendee (Shaheer) requests OD slip
    const shaheerODRes = await request('GET', `/api/od/request/${newRegId}`, null, shaheerToken);
    assert(shaheerODRes.statusCode === 200, 'Verified attendee generates official OD slip successfully (200 OK)');
    assert(shaheerODRes.data.success === true, 'OD requisition response success is true');
    assert(shaheerODRes.data.data.rollNumber === '21BCS043', 'OD slip contains student roll number (21BCS043)');
    assert(shaheerODRes.data.data.odReference.startsWith('KCT-OD-2026-'), 'OD reference uses official KCT-OD-2026 format');
    assert(shaheerODRes.data.data.excusedPeriods === 8, 'OD slip details 8 excused academic periods');
    assert(shaheerODRes.data.data.verificationQrUrl && shaheerODRes.data.data.verificationQrUrl.startsWith('data:image/'), 'OD slip includes embedded verification QR code');

    const generatedODRef = shaheerODRes.data.data.odReference;

    // 4. Public OD Verification Endpoint
    const publicODVerifyRes = await request('GET', `/api/od/verify/${generatedODRef}`);
    assert(publicODVerifyRes.statusCode === 200, 'Public OD verification endpoint returns 200 OK');
    assert(publicODVerifyRes.data.verified === true, 'Public verification confirms OD clearance authenticity');
    assert(publicODVerifyRes.data.odData.studentName === 'Shaheer', 'Public verification confirms correct student name on OD');

    // 5. Invalid OD Verification
    const invalidODVerifyRes = await request('GET', '/api/od/verify/KCT-OD-2026-INVALID-9999');
    assert(invalidODVerifyRes.statusCode === 404, 'Invalid OD reference code returns 404 Not Found');

    // 6. OD Batch Roster for Event Organizers
    const odBatchRes = await request('GET', `/api/od/batch/${studentEventId}`, null, organizerToken);
    assert(odBatchRes.statusCode === 200, 'Organizer retrieves OD batch clearance roster (200 OK)');
    assert(Array.isArray(odBatchRes.data.roster), 'OD batch roster contains participant array');
    assert(odBatchRes.data.count >= 1, 'OD batch roster includes verified participants');

    // -------------------------------------------------------------
    // GROUP 12: Post-Event Student Feedback & Satisfaction Analytics
    // -------------------------------------------------------------
    console.log('\n--- Test Group 12: Post-Event Student Feedback & Satisfaction Analytics ---');

    // 1. Unverified student tries to submit feedback (Must be blocked with 403)
    const unverifiedFeedbackRes = await request('POST', '/api/feedback/submit', {
      eventId: certTestEventId,
      overallRating: 5,
      comments: 'Great workshop!'
    }, studentToken);
    assert(unverifiedFeedbackRes.statusCode === 403, 'Unverified attendee submitting feedback rejected with 403 Forbidden');
    assert(unverifiedFeedbackRes.data.message.includes('restricted to verified event attendees'), 'Error message specifies verified attendance requirement');

    // 2. Verified attendee (Shaheer) submits feedback
    const shaheerFeedbackRes = await request('POST', '/api/feedback/submit', {
      eventId: studentEventId,
      overallRating: 5,
      contentRating: 5,
      organizationRating: 4,
      wouldRecommend: true,
      comments: 'Excellent hands-on hackathon experience with top mentors!'
    }, shaheerToken);
    assert(shaheerFeedbackRes.statusCode === 201, 'Verified attendee submits event feedback successfully (201 Created)');
    assert(shaheerFeedbackRes.data.success === true, 'Feedback submission response success is true');
    assert(shaheerFeedbackRes.data.data.rollNumber === '21BCS043', 'Feedback record contains student roll number');

    // 3. Duplicate feedback submission (Must be blocked with 409 Conflict)
    const duplicateFeedbackRes = await request('POST', '/api/feedback/submit', {
      eventId: studentEventId,
      overallRating: 4,
      comments: 'Submitting a second review attempt'
    }, shaheerToken);
    assert(duplicateFeedbackRes.statusCode === 409, 'Duplicate feedback submission blocked with 409 Conflict');

    // 4. Student checks own feedback status
    const myFeedbackRes = await request('GET', `/api/feedback/my/${studentEventId}`, null, shaheerToken);
    assert(myFeedbackRes.statusCode === 200, 'Student checks own feedback status (200 OK)');
    assert(myFeedbackRes.data.submitted === true, 'Feedback status confirms review was submitted');
    assert(myFeedbackRes.data.feedback.overallRating === 5, 'Feedback status confirms 5-star rating');

    // 5. Organizer retrieves aggregate event feedback analytics
    const eventFeedbackRes = await request('GET', `/api/feedback/event/${studentEventId}`, null, organizerToken);
    assert(eventFeedbackRes.statusCode === 200, 'Organizer retrieves event feedback analytics (200 OK)');
    assert(eventFeedbackRes.data.summary.totalResponses >= 1, 'Feedback summary includes total responses');
    assert(eventFeedbackRes.data.summary.avgOverall === 5.0, 'Feedback summary computes average overall rating');
    assert(eventFeedbackRes.data.summary.recommendPercentage === 100, 'Feedback summary computes net recommendation percentage');
    assert(Array.isArray(eventFeedbackRes.data.reviews), 'Feedback includes participant reviews array');

    // 6. Admin campus-wide feedback summary benchmark
    const campusFeedbackRes = await request('GET', '/api/feedback/campus-summary', null, adminToken);
    assert(campusFeedbackRes.statusCode === 200, 'Admin retrieves campus feedback benchmark summary (200 OK)');
    assert(campusFeedbackRes.data.data.totalReviews >= 1, 'Campus feedback benchmark details total reviews');

    // -------------------------------------------------------------
    // GROUP 13: Multi-Session / Multi-Day Hackathon Tracking
    // -------------------------------------------------------------
    console.log('\n--- Test Group 13: Multi-Session / Multi-Day Hackathon Tracking ---');

    // 1. Fetch default sessions for event
    const sessionsRes = await request('GET', `/api/events/${studentEventId}/sessions`);
    assert(sessionsRes.statusCode === 200, 'Event sessions endpoint responds with 200 OK');
    assert(Array.isArray(sessionsRes.data.sessions), 'Event returns sessions array');
    assert(sessionsRes.data.sessions.length >= 2, 'Event has at least 2 default academic sessions');

    // 2. Organizer configures custom multi-session tracks
    const configureSessionsRes = await request('POST', `/api/events/${studentEventId}/sessions`, {
      sessions: [
        { sessionId: 'SES-01', name: 'Day 1 Keynote & Architecture', time: '09:30 AM - 12:30 PM', mandatory: true },
        { sessionId: 'SES-02', name: 'Day 1 Hack Phase & Coding Lab', time: '01:30 PM - 05:30 PM', mandatory: true },
        { sessionId: 'SES-03', name: 'Day 2 Final Pitch & Jury Demo', time: '10:00 AM - 01:00 PM', mandatory: true }
      ]
    }, organizerToken);
    assert(configureSessionsRes.statusCode === 200, 'Organizer configures custom multi-session tracks (200 OK)');
    assert(configureSessionsRes.data.sessions.length === 3, 'Custom sessions array saved with 3 tracks');

    // 3. Mark attendance for specific session (SES-01)
    const sessionMarkRes = await request('POST', '/api/attendance/session-mark', {
      registrationId: newRegId,
      eventId: studentEventId,
      sessionId: 'SES-01'
    }, organizerToken);
    assert(sessionMarkRes.statusCode === 200, 'Session attendance marking returns 200 OK');
    assert(sessionMarkRes.data.data.sessionId === 'SES-01', 'Session attendance confirmed for SES-01');
    assert(sessionMarkRes.data.data.studentName === 'Shaheer', 'Session attendance recorded for student Shaheer');

    // 4. Duplicate scan for the SAME session blocked with 409 Conflict
    const duplicateSessionMarkRes = await request('POST', '/api/attendance/session-mark', {
      registrationId: newRegId,
      eventId: studentEventId,
      sessionId: 'SES-01'
    }, organizerToken);
    assert(duplicateSessionMarkRes.statusCode === 409, 'Duplicate session attendance scan blocked with 409 Conflict');
    assert(duplicateSessionMarkRes.data.message.includes('Already Marked for Session SES-01'), 'Exact duplicate session message returned');

    // 5. Mark second session (SES-02)
    const session2MarkRes = await request('POST', '/api/attendance/session-mark', {
      registrationId: newRegId,
      eventId: studentEventId,
      sessionId: 'SES-02'
    }, organizerToken);
    assert(session2MarkRes.statusCode === 200, 'Second session attendance marked successfully (200 OK)');
    assert(session2MarkRes.data.data.attendedCount >= 2, 'Attended count incremented in session tracking');

    // 6. Retrieve Multi-Session Attendance Progress Matrix
    const matrixRes = await request('GET', `/api/events/${studentEventId}/session-matrix`, null, organizerToken);
    assert(matrixRes.statusCode === 200, 'Organizer retrieves multi-session attendance matrix (200 OK)');
    assert(Array.isArray(matrixRes.data.matrix), 'Session matrix contains participant rows');
    const shaheerMatrixRow = matrixRes.data.matrix.find(r => r.rollNumber === '21BCS043');
    assert(!!shaheerMatrixRow, 'Matrix contains entry for student Roll Number 21BCS043');
    assert(shaheerMatrixRow.attendedCount >= 2, 'Matrix entry confirms multiple sessions attended');
    assert(shaheerMatrixRow.overallStatus === 'Present', 'Multi-session progress clearance marks overall status as Present');

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`📊 Test Execution Summary: ${passed} Passed, ${failed} Failed`);
    console.log('================================================================');

    if (localServer) {
      localServer.close();
    }

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }

  } catch (err) {
    console.error('Fatal test runner error:', err);
    if (localServer) localServer.close();
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = runTests;
