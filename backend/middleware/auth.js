/**
 * EventHub - Role-Based Authentication & Authorization Middleware
 * Supports:
 * - JWT Token Verification
 * - Role enforcement (student, organizer, admin)
 * - Ownership & resource permission checks
 */

const jwt = require('jsonwebtoken');
const { getFirestore } = require('../firebase');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('FATAL: JWT_SECRET environment variable is mandatory in production'); })() : 'kct_eventhub_super_secret_jwt_key_2026_rbac_secure');

/**
 * Generate a cryptographically signed JWT token
 */
function generateToken(user, expiresIn = '24h') {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      rollNumber: user.rollNumber || user.registerNumber || ''
    },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Extract token from Authorization header or query parameter
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  // Support token in query string for file downloads (CSV, QR)
  if (req.query && req.query.token) {
    return req.query.token.trim();
  }
  return null;
}

/**
 * Middleware: Verify user authentication via JWT
 * Rejects unauthenticated requests with HTTP 401
 */
async function authenticateUser(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. No token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getFirestore();

    // Look up user in Firestore to verify existence and get latest role
    let userDoc = await db.collection('users').doc(decoded.id).get();
    let userData = userDoc.exists ? userDoc.data() : null;

    // Backward compatibility check for organizers collection if not yet migrated
    if (!userData) {
      const orgDoc = await db.collection('organizers').doc(decoded.id).get();
      if (orgDoc.exists) {
        userData = orgDoc.data();
        userData.role = userData.role || 'organizer';
      }
    }

    if (!userData) {
      return res.status(401).json({
        success: false,
        message: 'User account associated with this session no longer exists.'
      });
    }

    // Account activation / deactivation check
    if (userData.accountStatus === 'inactive') {
      return res.status(403).json({
        success: false,
        accountInactive: true,
        message: 'Your account has been deactivated. Please contact the administrator.'
      });
    }

    // Attach verified user to request
    req.user = {
      id: decoded.id,
      email: userData.email,
      role: userData.role,
      name: userData.name,
      department: userData.department || '',
      rollNumber: userData.rollNumber || userData.registerNumber || '',
      registerNumber: userData.rollNumber || userData.registerNumber || '',
      year: userData.year || '',
      phone: userData.phone || '',
      accountStatus: userData.accountStatus || 'active'
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid or forged authentication token.'
    });
  }
}

/**
 * Middleware: Optional authentication
 * Attaches req.user if a valid token is provided, but continues if unauthenticated
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getFirestore();
    let userDoc = await db.collection('users').doc(decoded.id).get();
    if (userDoc.exists) {
      const u = userDoc.data();
      req.user = {
        id: decoded.id,
        email: u.email,
        role: u.role,
        name: u.name,
        department: u.department || '',
        registerNumber: u.registerNumber || ''
      };
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }
  next();
}

/**
 * Middleware Factory: Enforce specific role(s)
 * Rejects authenticated users lacking sufficient privileges with HTTP 403
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Requires ${allowedRoles.join(' or ')} role. Your role is '${req.user.role}'.`
      });
    }

    next();
  };
}

module.exports = {
  JWT_SECRET,
  generateToken,
  authenticateUser,
  optionalAuth,
  requireRole
};
