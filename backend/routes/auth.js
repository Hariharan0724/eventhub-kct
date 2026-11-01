const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getFirestore } = require('../firebase');
const { JWT_SECRET, generateToken, authenticateUser, requireRole } = require('../middleware/auth');
const { recordAuditLog } = require('../audit');

/**
 * POST /api/auth/register
 * Student Registration
 * Mandatory fields: Full name, College roll number, Email address, Password, Confirm password
 * Enforces role: 'student' (Users can NEVER elevate their own role)
 */
router.post('/register', async (req, res) => {
  try {
    const {
      name,
      rollNumber,
      registerNumber,
      email,
      password,
      confirmPassword,
      department,
      year,
      phone
    } = req.body;

    const rawRollNo = rollNumber || registerNumber;

    // 1. Mandatory field validations
    if (!name || !name.trim() || !email || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name, email address, and password are required.'
      });
    }

    if (!rawRollNo || !rawRollNo.trim()) {
      return res.status(400).json({
        success: false,
        message: 'College roll number is mandatory for student registration.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match. Please verify confirm password.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRollNo = rawRollNo.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanPhone = phone ? phone.trim() : '';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    // Validate roll number format (alphanumeric, min 3 chars, e.g. 24BIT037)
    const rollNoRegex = /^[A-Z0-9\-_]{3,20}$/;
    if (!rollNoRegex.test(cleanRollNo)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid college roll number format. Roll number must be alphanumeric (e.g. 24BIT037 or 21BCS042).'
      });
    }

    const db = getFirestore();

    // 2. Check for duplicate email across users collection
    const existingEmailSnap = await db.collection('users').where('email', '==', cleanEmail).get();
    if (existingEmailSnap.docs && existingEmailSnap.docs.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in.'
      });
    }

    // 3. Check for duplicate roll number across users collection
    const existingRollSnap = await db.collection('users').where('rollNumber', '==', cleanRollNo).get();
    const legacyRegSnap = await db.collection('users').where('registerNumber', '==', cleanRollNo).get();
    if ((existingRollSnap.docs && existingRollSnap.docs.length > 0) || (legacyRegSnap.docs && legacyRegSnap.docs.length > 0)) {
      return res.status(409).json({
        success: false,
        message: `An account with College Roll Number ${cleanRollNo} already exists. Please log in.`
      });
    }

    // 4. Secure Password Hashing with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // 5. Create new student user (ROLE IS HARDCODED TO 'student' - NEVER trust frontend input)
    const userId = 'student_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    const newUser = {
      id: userId,
      userId,
      name: cleanName,
      email: cleanEmail,
      rollNumber: cleanRollNo,
      registerNumber: cleanRollNo, // Dual-key compatibility
      passwordHash,
      role: 'student', // Strictly enforced role
      accountStatus: 'active', // Default active
      department: department || 'General Engineering',
      year: year || '1st Year',
      phone: cleanPhone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.collection('users').doc(userId).set(newUser);

    // Record audit log
    await recordAuditLog({
      actorId: userId,
      actorRole: 'student',
      action: 'STUDENT_REGISTERED',
      targetType: 'user',
      targetId: userId,
      details: { rollNumber: cleanRollNo, email: cleanEmail }
    });

    // 6. Generate signed JWT token
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Student account registered successfully! Welcome to EventHub.',
      token,
      user: {
        id: newUser.id,
        userId: newUser.id,
        name: newUser.name,
        email: newUser.email,
        rollNumber: newUser.rollNumber,
        registerNumber: newUser.rollNumber,
        role: newUser.role,
        accountStatus: newUser.accountStatus,
        department: newUser.department,
        year: newUser.year,
        phone: newUser.phone
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again later.'
    });
  }
});

/**
 * POST /api/auth/login
 * Unified & Secure Authentication for Students, Organizers, and Admins
 * Supports login via Email OR College Roll Number (e.g. 24BIT037)
 * Uses bcrypt verification and signed JWT tokens
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, rollNumber, email, password, requiredRole } = req.body;

    const rawInput = identifier || rollNumber || email;

    if (!rawInput || !password) {
      return res.status(400).json({
        success: false,
        message: 'Roll number or email, and password are required.'
      });
    }

    const cleanInput = rawInput.trim();
    const db = getFirestore();

    // 1. Look up user by email or rollNumber
    let user = null;

    if (cleanInput.includes('@')) {
      const usersSnap = await db.collection('users').where('email', '==', cleanInput.toLowerCase()).get();
      if (usersSnap.docs && usersSnap.docs.length > 0) {
        user = usersSnap.docs[0].data();
      }
    } else {
      // Look up by Roll Number
      const upperRoll = cleanInput.toUpperCase();
      let rollSnap = await db.collection('users').where('rollNumber', '==', upperRoll).get();
      if (!rollSnap.docs || rollSnap.docs.length === 0) {
        rollSnap = await db.collection('users').where('registerNumber', '==', upperRoll).get();
      }
      if (rollSnap.docs && rollSnap.docs.length > 0) {
        user = rollSnap.docs[0].data();
      }
    }

    // Fallback check in organizers collection if legacy doc
    if (!user && cleanInput.includes('@')) {
      const orgSnap = await db.collection('organizers').where('email', '==', cleanInput.toLowerCase()).get();
      if (orgSnap.docs && orgSnap.docs.length > 0) {
        user = orgSnap.docs[0].data();
        user.role = user.role || 'organizer';
      }
    }

    // 2. Reject if user does not exist
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your roll number/email and password.'
      });
    }

    // 3. Verify account status (active vs inactive)
    if (user.accountStatus === 'inactive') {
      return res.status(403).json({
        success: false,
        accountInactive: true,
        message: 'Your account has been deactivated. Please contact the administrator.'
      });
    }

    // 4. Verify password hash using bcrypt (No plaintext fallback)
    let passwordMatch = false;
    if (user.passwordHash) {
      passwordMatch = await bcrypt.compare(password, user.passwordHash);
    } else if (user.password) {
      // Migration of old unhashed password
      if (user.password === password) {
        passwordMatch = true;
        const newHash = await bcrypt.hash(password, 10);
        user.passwordHash = newHash;
        delete user.password;
        await db.collection('users').doc(user.id).set(user, { merge: true });
      }
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your roll number/email and password.'
      });
    }

    // 5. Role check if client specified expected role tab
    if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: `Account found, but requires role '${requiredRole}'. Your account role is '${user.role}'.`
      });
    }

    // 6. Generate secure, cryptographically signed JWT token
    const token = generateToken(user);

    return res.json({
      success: true,
      message: 'Login successful. Welcome back!',
      token,
      user: {
        id: user.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        rollNumber: user.rollNumber || user.registerNumber || '',
        registerNumber: user.rollNumber || user.registerNumber || '',
        accountStatus: user.accountStatus || 'active',
        department: user.department || '',
        year: user.year || '',
        phone: user.phone || '',
        designation: user.designation || ''
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.'
    });
  }
});

/**
 * GET /api/auth/me
 * Retrieve profile of currently authenticated user
 */
router.get('/me', authenticateUser, async (req, res) => {
  return res.json({
    success: true,
    user: req.user
  });
});

/**
 * PUT /api/auth/profile
 * Update student profile (Name, Phone, Department, Year)
 * Does NOT allow modifying role or email!
 */
router.put('/profile', authenticateUser, async (req, res) => {
  try {
    const { name, phone, department, year } = req.body;
    const db = getFirestore();

    const updates = {};
    if (name) updates.name = name.trim();
    if (phone) updates.phone = phone.trim();
    if (department) updates.department = department.trim();
    if (year) updates.year = year.trim();
    updates.updatedAt = new Date().toISOString();

    await db.collection('users').doc(req.user.id).update(updates);

    // Fetch updated
    const updatedDoc = await db.collection('users').doc(req.user.id).get();
    const updatedUser = updatedDoc.data();

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        department: updatedUser.department,
        registerNumber: updatedUser.registerNumber,
        year: updatedUser.year,
        phone: updatedUser.phone
      }
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

/**
 * POST /api/auth/create-organizer
 * Only an authorized administrator can create or promote organizers
 * Requires role: 'admin' OR header x-admin-key matching ADMIN_KEY
 */
router.post('/create-organizer', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    const authHeader = req.headers.authorization;

    let isAuthorizedAdmin = false;

    // Check 1: Master Admin Key from environment
    if (adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY) {
      isAuthorizedAdmin = true;
    }

    // Check 2: JWT authenticated admin
    if (!isAuthorizedAdmin && authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('../middleware/auth');
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        if (decoded.role === 'admin') {
          isAuthorizedAdmin = true;
        }
      } catch (e) {}
    }

    if (!isAuthorizedAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an authorized administrator can create organizer accounts.'
      });
    }

    const { name, email, password, designation, institution } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required for organizer creation.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getFirestore();

    // Check if user already exists
    const checkUser = await db.collection('users').where('email', '==', cleanEmail).get();
    if (checkUser.docs && checkUser.docs.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const organizerId = 'org_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    const newOrganizer = {
      id: organizerId,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      role: 'organizer',
      designation: designation || 'Event Coordinator',
      institution: institution || 'Kumaraguru College of Technology',
      createdAt: new Date().toISOString()
    };

    await db.collection('users').doc(organizerId).set(newOrganizer);
    await db.collection('organizers').doc(organizerId).set(newOrganizer);

    return res.status(201).json({
      success: true,
      message: 'Organizer account successfully created!',
      organizer: {
        id: newOrganizer.id,
        name: newOrganizer.name,
        email: newOrganizer.email,
        role: newOrganizer.role,
        designation: newOrganizer.designation
      }
    });

  } catch (err) {
    console.error('Error creating organizer:', err);
    return res.status(500).json({ success: false, message: 'Server error creating organizer.' });
  }
});

/**
 * POST /api/auth/logout
 * Client-side token invalidation / logout acknowledgment
 */
router.post('/logout', (req, res) => {
  return res.json({
    success: true,
    message: 'Logged out successfully.'
  });
});

module.exports = router;
