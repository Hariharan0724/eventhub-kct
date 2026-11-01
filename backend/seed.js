/**
 * EventHub - Demo Database Seeder with Role-Based Authentication & Audit Logging
 * Seeds realistic KCT events, organizers, students, registrations, attendance, and audit logs.
 */

const bcrypt = require('bcryptjs');
const { getFirestore } = require('./firebase');

async function seedData(force = false) {
  const db = getFirestore();
  const usersCol = db.collection('users');
  const eventsCol = db.collection('events');
  const registrationsCol = db.collection('registrations');
  const organizersCol = db.collection('organizers');
  const attendanceCol = db.collection('attendance');
  const auditLogsCol = db.collection('auditLogs');

  // Check if users already exist
  const existingUsers = await usersCol.get();
  if (!force && existingUsers.docs && existingUsers.docs.length > 0) {
    console.log('ℹ Database already has users, skipping seed. Use force to re-seed.');
    return;
  }

  console.log('🔐 Seeding demo users, organizers, events, attendance, and audit logs...');

  // Standard password hashes (cost factor: 10)
  const organizerPasswordHash = bcrypt.hashSync('admin@kct2026', 10);
  const studentPasswordHash = bcrypt.hashSync('student@kct2026', 10);

  // 1. Seed Organizers and Administrators into `users` collection
  const defaultUsers = [
    {
      id: 'kct_organizer_1',
      name: 'EventHub Organizer',
      email: 'organizer@kct.ac.in',
      passwordHash: organizerPasswordHash,
      role: 'organizer',
      accountStatus: 'active',
      designation: 'Faculty Head - Student Affairs & Events',
      institution: 'Kumaraguru College of Technology, Coimbatore',
      createdAt: new Date().toISOString()
    },
    {
      id: 'kct_admin_root',
      name: 'EventHub System Administrator',
      email: 'admin@kct.ac.in',
      passwordHash: organizerPasswordHash,
      role: 'admin',
      accountStatus: 'active',
      designation: 'Chief Technology Administrator',
      institution: 'Kumaraguru College of Technology, Coimbatore',
      createdAt: new Date().toISOString()
    },
    {
      id: 'student_hariharan_1',
      name: 'Hariharan',
      email: 'hariharan@kct.ac.in',
      passwordHash: studentPasswordHash,
      role: 'student',
      accountStatus: 'active',
      rollNumber: '21BCS042',
      registerNumber: '21BCS042',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543210',
      createdAt: new Date().toISOString()
    },
    {
      id: 'student_shaheer_2',
      name: 'Shaheer',
      email: 'shaheer@kct.ac.in',
      passwordHash: studentPasswordHash,
      role: 'student',
      accountStatus: 'active',
      rollNumber: '21BCS043',
      registerNumber: '21BCS043',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543211',
      createdAt: new Date().toISOString()
    },
    {
      id: 'student_ashwanth_3',
      name: 'Ashwanth',
      email: 'ashwanth@kct.ac.in',
      passwordHash: studentPasswordHash,
      role: 'student',
      accountStatus: 'active',
      rollNumber: '21BCS044',
      registerNumber: '21BCS044',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543212',
      createdAt: new Date().toISOString()
    }
  ];

  for (const user of defaultUsers) {
    await usersCol.doc(user.id).set(user);
    if (user.role === 'organizer' || user.role === 'admin') {
      await organizersCol.doc(user.id).set({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        accountStatus: user.accountStatus,
        designation: user.designation,
        institution: user.institution,
        createdAt: user.createdAt
      });
    }
  }

  // 2. Events with assigned organizerId and approvalStatus
  const events = [
    {
      id: 'evt_ai_ml_workshop',
      organizerId: 'kct_organizer_1',
      createdBy: 'kct_organizer_1',
      createdByRole: 'organizer',
      createdByName: 'EventHub Organizer',
      name: 'AI & Machine Learning Workshop',
      category: 'Workshop',
      date: '2026-10-15',
      time: '09:30 AM - 04:30 PM',
      venue: 'KCT Campus - Ramanujan Block Mech Lab 2',
      organizer: 'Department of AI & Data Science',
      capacity: 150,
      registeredCount: 3,
      presentCount: 2,
      registrationDeadline: '2026-10-14T23:59:59',
      image: 'https://images.unsplash.com/photo-1591453089816-0fbb971b454c?auto=format&fit=crop&w=800&q=80',
      description: 'Hands-on intensive workshop focusing on real-world Deep Learning pipelines, PyTorch architecture, Neural Network optimization, and Generative AI deployment.',
      rules: '1. Participants must bring their own laptops.\n2. EventHub Digital QR Code must be shown at the entrance.',
      status: 'open',
      approvalStatus: 'approved',
      approvedBy: 'kct_admin_root',
      approvedAt: '2026-09-02T10:00:00.000Z',
      createdAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'evt_codesprint',
      organizerId: 'kct_organizer_1',
      createdBy: 'kct_organizer_1',
      createdByRole: 'organizer',
      createdByName: 'EventHub Organizer',
      name: 'CodeSprint 24-Hour Hackathon',
      category: 'Hackathon',
      date: '2026-10-22',
      time: '08:00 AM - 08:00 PM',
      venue: 'KCT Tech Park - C-DAC Innovation Lab',
      organizer: 'KCT Hacker Club & CSE Dept',
      capacity: 200,
      registeredCount: 1,
      presentCount: 0,
      registrationDeadline: '2026-10-20T18:00:00',
      image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80',
      description: 'Annual flagship coding marathon challenging student teams to innovate solutions for Smart Coimbatore, Sustainable Mobility, and Campus Automation.',
      rules: '1. Maximum 4 members per team.\n2. QR Check-in opens at 07:30 AM sharp at C-DAC entrance.',
      status: 'open',
      approvalStatus: 'approved',
      approvedBy: 'kct_admin_root',
      approvedAt: '2026-09-06T12:00:00.000Z',
      createdAt: '2026-09-05T12:00:00.000Z'
    },
    {
      id: 'evt_cloud_computing',
      organizerId: 'kct_organizer_1',
      createdBy: 'kct_organizer_1',
      createdByRole: 'organizer',
      createdByName: 'EventHub Organizer',
      name: 'Cloud Computing & DevOps Bootcamp',
      category: 'Workshop',
      date: '2026-10-28',
      time: '10:00 AM - 03:30 PM',
      venue: 'Admin Block Seminar Hall II',
      organizer: 'Department of Information Technology',
      capacity: 100,
      registeredCount: 0,
      presentCount: 0,
      registrationDeadline: '2026-10-27T17:00:00',
      image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
      description: 'Master Docker containerization, Kubernetes orchestration, and CI/CD automated deployment pipelines with AWS cloud credits provided for attendees.',
      rules: '1. Basic knowledge of Linux command line is recommended.\n2. Show your EventHub QR code at the seminar hall registration desk.',
      status: 'open',
      approvalStatus: 'approved',
      approvedBy: 'kct_admin_root',
      approvedAt: '2026-09-11T14:30:00.000Z',
      createdAt: '2026-09-10T14:30:00.000Z'
    },
    {
      id: 'evt_tech_symposium',
      organizerId: 'kct_organizer_1',
      createdBy: 'student_hariharan_1',
      createdByRole: 'student',
      createdByName: 'Hariharan',
      name: 'KCT Tech Symposium 2026',
      category: 'Technical',
      date: '2026-11-05',
      time: '09:00 AM - 05:00 PM',
      venue: 'Mahatma Gandhi Central Auditorium',
      organizer: 'Student Affairs & ISTE KCT Chapter',
      capacity: 350,
      registeredCount: 0,
      presentCount: 0,
      registrationDeadline: '2026-11-03T23:59:59',
      image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80',
      description: 'The premier student technical congregation bringing together guest keynotes, paper presentations, and robotics showcases.',
      rules: '1. Open to all departments and year levels.\n2. Formal college dress code and valid KCT ID card along with EventHub QR pass required.',
      status: 'open',
      approvalStatus: 'pending',
      createdAt: '2026-10-01T09:00:00.000Z'
    }
  ];

  for (const evt of events) {
    await eventsCol.doc(evt.id).set(evt);
  }

  // 3. Sample Registrations with Roll Numbers
  const sampleRegistrations = [
    {
      registrationId: 'EVT-2026-0001',
      userId: 'student_hariharan_1',
      eventId: 'evt_ai_ml_workshop',
      eventName: 'AI & Machine Learning Workshop',
      studentName: 'Hariharan',
      email: 'hariharan@kct.ac.in',
      rollNumber: '21BCS042',
      registerNumber: '21BCS042',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543210',
      attendanceStatus: 'Registered',
      checkInTime: null,
      registeredAt: '2026-10-01T10:30:00.000Z',
      qrCodeData: 'EVT-2026-0001'
    },
    {
      registrationId: 'EVT-2026-0002',
      userId: 'student_shaheer_2',
      eventId: 'evt_ai_ml_workshop',
      eventName: 'AI & Machine Learning Workshop',
      studentName: 'Shaheer',
      email: 'shaheer@kct.ac.in',
      rollNumber: '21BCS043',
      registerNumber: '21BCS043',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543211',
      attendanceStatus: 'Present',
      checkInTime: '2026-10-15T09:42:15.000Z',
      registeredAt: '2026-10-02T11:15:00.000Z',
      qrCodeData: 'EVT-2026-0002'
    },
    {
      registrationId: 'EVT-2026-0003',
      userId: 'student_ashwanth_3',
      eventId: 'evt_ai_ml_workshop',
      eventName: 'AI & Machine Learning Workshop',
      studentName: 'Ashwanth',
      email: 'ashwanth@kct.ac.in',
      rollNumber: '21BCS044',
      registerNumber: '21BCS044',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543212',
      attendanceStatus: 'Present',
      checkInTime: '2026-10-15T09:48:30.000Z',
      registeredAt: '2026-10-03T14:20:00.000Z',
      qrCodeData: 'EVT-2026-0003'
    },
    {
      registrationId: 'EVT-2026-0099',
      userId: 'student_hariharan_1',
      eventId: 'evt_codesprint',
      eventName: 'CodeSprint 24-Hour Hackathon',
      studentName: 'Hariharan',
      email: 'hariharan@kct.ac.in',
      rollNumber: '21BCS042',
      registerNumber: '21BCS042',
      department: 'Computer Science and Engineering',
      year: '4th Year',
      phone: '9876543210',
      attendanceStatus: 'Registered',
      checkInTime: null,
      registeredAt: '2026-10-06T15:00:00.000Z',
      qrCodeData: 'EVT-2026-0099'
    }
  ];

  for (const reg of sampleRegistrations) {
    await registrationsCol.doc(reg.registrationId).set(reg);
  }

  // 4. Sample Attendance Records
  const sampleAttendance = [
    {
      attendanceId: 'att_evt_ai_ml_workshop_EVT-2026-0002',
      eventId: 'evt_ai_ml_workshop',
      eventName: 'AI & Machine Learning Workshop',
      registrationId: 'EVT-2026-0002',
      studentId: 'student_shaheer_2',
      studentName: 'Shaheer',
      rollNumberSnapshot: '21BCS043',
      organizerId: 'kct_organizer_1',
      organizerName: 'EventHub Organizer',
      status: 'Present',
      checkInTime: '2026-10-15T09:42:15.000Z',
      timestamp: '2026-10-15T09:42:15.000Z'
    },
    {
      attendanceId: 'att_evt_ai_ml_workshop_EVT-2026-0003',
      eventId: 'evt_ai_ml_workshop',
      eventName: 'AI & Machine Learning Workshop',
      registrationId: 'EVT-2026-0003',
      studentId: 'student_ashwanth_3',
      studentName: 'Ashwanth',
      rollNumberSnapshot: '21BCS044',
      organizerId: 'kct_organizer_1',
      organizerName: 'EventHub Organizer',
      status: 'Present',
      checkInTime: '2026-10-15T09:48:30.000Z',
      timestamp: '2026-10-15T09:48:30.000Z'
    }
  ];

  for (const att of sampleAttendance) {
    await attendanceCol.doc(att.attendanceId).set(att);
  }

  // 5. Initial Audit Logs
  const initialAuditLogs = [
    {
      auditId: 'audit_init_001',
      actorId: 'kct_admin_root',
      actorRole: 'admin',
      action: 'SYSTEM_INITIALIZED',
      targetType: 'system',
      targetId: 'kct_eventhub_core',
      reason: 'Initial deployment and role-based security configuration',
      details: { environment: 'KCT Production Candidate', timestamp: new Date().toISOString() },
      timestamp: '2026-10-01T08:00:00.000Z'
    },
    {
      auditId: 'audit_init_002',
      actorId: 'kct_admin_root',
      actorRole: 'admin',
      action: 'EVENT_APPROVED',
      targetType: 'event',
      targetId: 'evt_ai_ml_workshop',
      reason: null,
      details: { eventName: 'AI & Machine Learning Workshop', approvedBy: 'kct_admin_root' },
      timestamp: '2026-10-01T09:00:00.000Z'
    },
    {
      auditId: 'audit_init_003',
      actorId: 'kct_organizer_1',
      actorRole: 'organizer',
      action: 'ATTENDANCE_MARKED',
      targetType: 'attendance',
      targetId: 'att_evt_ai_ml_workshop_EVT-2026-0002',
      reason: null,
      details: { eventId: 'evt_ai_ml_workshop', studentName: 'Shaheer', rollNumber: '21BCS043' },
      timestamp: '2026-10-15T09:42:15.000Z'
    }
  ];

  for (const log of initialAuditLogs) {
    await auditLogsCol.doc(log.auditId).set(log);
  }

  console.log('✅ Demo users, organizers, events, registrations, attendance, and audit logs successfully seeded!');
}

if (require.main === module) {
  seedData(true).then(() => {
    console.log('Seed script complete.');
    process.exit(0);
  }).catch(err => {
    console.error('Seed script error:', err);
    process.exit(1);
  });
}

module.exports = seedData;
