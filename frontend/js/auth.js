/**
 * EventHub - Client-side Role-Based Authentication & Session Guard
 * Manages JWT tokens, authenticated state, and dynamic role-based navigation
 */

const TOKEN_KEY = 'eventhub_token';
const USER_KEY = 'eventhub_user';
const LEGACY_TOKEN_KEY = 'eventhub_auth_token';
const LEGACY_USER_KEY = 'eventhub_user_profile';

// Get current auth token
function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || null;
}

// Get authenticated user object
function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Check if a session exists
function isLoggedIn() {
  return !!getAuthToken();
}

// Get user role ('student', 'organizer', 'admin')
function getUserRole() {
  const user = getCurrentUser();
  return user ? user.role : null;
}

// Role Check Helpers
function isStudent() {
  return getUserRole() === 'student';
}

function isOrganizer() {
  const role = getUserRole();
  return role === 'organizer' || role === 'admin';
}

function isAdmin() {
  return getUserRole() === 'admin';
}

// Standard authenticated fetch headers
function getAuthHeaders(additional = {}) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...additional };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Route Guard: Protect Student-only pages (e.g. student-dashboard.html)
 */
function requireStudentAuth() {
  if (!isLoggedIn()) {
    sessionStorage.setItem('redirect_after_login', window.location.href);
    window.location.href = 'login.html?role=student&auth=required';
    return false;
  }
  if (!isStudent()) {
    if (isAdmin()) {
      window.location.href = 'admin-dashboard.html';
    } else {
      window.location.href = 'organizer-dashboard.html';
    }
    return false;
  }
  return true;
}

/**
 * Route Guard: Protect Organizer-only pages (e.g. organizer-dashboard.html, attendance.html, participants.html)
 */
function requireOrganizerAuth() {
  if (!isLoggedIn()) {
    sessionStorage.setItem('redirect_after_login', window.location.href);
    window.location.href = 'login.html?role=organizer&auth=required';
    return false;
  }
  if (!isOrganizer() && !isAdmin()) {
    showToast('Access denied: You do not have organizer privileges.', 'error');
    window.location.href = 'student-dashboard.html?denied=organizer_only';
    return false;
  }
  return true;
}

/**
 * Route Guard: Protect Admin-only pages (e.g. admin-dashboard.html)
 */
function requireAdminAuth() {
  if (!isLoggedIn()) {
    sessionStorage.setItem('redirect_after_login', window.location.href);
    window.location.href = 'login.html?role=admin&auth=required';
    return false;
  }
  if (!isAdmin()) {
    showToast('Access denied: Administrator privileges required.', 'error');
    if (isOrganizer()) {
      window.location.href = 'organizer-dashboard.html';
    } else {
      window.location.href = 'student-dashboard.html';
    }
    return false;
  }
  return true;
}

/**
 * Perform Login (Student, Organizer, or Admin)
 */
async function loginUser(identifier, password, requiredRole = null) {
  try {
    const payload = { identifier, password };
    if (requiredRole) payload.role = requiredRole;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      localStorage.setItem(LEGACY_TOKEN_KEY, data.token);
      localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(data.user));
      return { success: true, user: data.user, token: data.token };
    }
    return { success: false, message: data.message || 'Login failed.' };
  } catch (err) {
    console.error('Login network error:', err);
    return { success: false, message: 'Unable to connect to authentication server.' };
  }
}

/**
 * Perform Student Registration
 */
async function registerStudent(formData) {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const data = await res.json();
    if (res.status === 201 && data.success && data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      localStorage.setItem(LEGACY_TOKEN_KEY, data.token);
      localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(data.user));
      return { success: true, user: data.user, token: data.token };
    }
    return { success: false, message: data.message || 'Registration failed.' };
  } catch (err) {
    console.error('Registration network error:', err);
    return { success: false, message: 'Server communication error during registration.' };
  }
}

/**
 * Logout User
 */
async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_USER_KEY);
  window.location.href = 'login.html?logged_out=true';
}

function logoutOrganizer() {
  logoutUser();
}

/**
 * Dynamic Navigation Setup based on Authenticated Role
 */
function setupNavbar() {
  const navContainer = document.querySelector('.nav-actions');
  const navLinksContainer = document.querySelector('.nav-links');
  if (!navContainer) return;

  const user = getCurrentUser();
  const currentPath = window.location.pathname;

  if (isLoggedIn() && user) {
    if (isAdmin()) {
      if (navLinksContainer) {
        navLinksContainer.innerHTML = `
          <li><a href="admin-dashboard.html" class="nav-link ${currentPath.includes('admin') ? 'active' : ''}">Admin Console</a></li>
          <li><a href="event-approvals.html" class="nav-link ${currentPath.includes('approvals') ? 'active' : ''}">Approvals</a></li>
          <li><a href="organizer-dashboard.html" class="nav-link ${currentPath.includes('organizer-dashboard') ? 'active' : ''}">Organizer View</a></li>
          <li><a href="attendance.html" class="nav-link ${currentPath.includes('attendance') ? 'active' : ''}">Scanner</a></li>
          <li><a href="events.html" class="nav-link ${currentPath.includes('events') ? 'active' : ''}">Events Catalog</a></li>
        `;
      }
      navContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge" style="background: #f5f3ff; color: #6d28d9; border: 1px solid #c4b5fd;">
            ${user.name} (Admin)
          </span>
          <a href="admin-dashboard.html" class="btn btn-outline btn-sm">Console</a>
          <button onclick="logoutUser()" class="btn btn-sm btn-danger">Logout</button>
        </div>
      `;
    } else if (isOrganizer()) {
      if (navLinksContainer) {
        navLinksContainer.innerHTML = `
          <li><a href="organizer-dashboard.html" class="nav-link ${currentPath.includes('organizer-dashboard') ? 'active' : ''}">Dashboard</a></li>
          <li><a href="event-approvals.html" class="nav-link ${currentPath.includes('approvals') ? 'active' : ''}">Approvals</a></li>
          <li><a href="attendance.html" class="nav-link ${currentPath.includes('attendance') ? 'active' : ''}">QR Scanner</a></li>
          <li><a href="participants.html" class="nav-link ${currentPath.includes('participants') ? 'active' : ''}">Participants</a></li>
          <li><a href="events.html" class="nav-link ${currentPath.includes('events') ? 'active' : ''}">Events Catalog</a></li>
        `;
      }
      navContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge badge-category">
            ${user.name || 'Organizer'} (Organizer)
          </span>
          <a href="organizer-dashboard.html" class="btn btn-outline btn-sm">Dashboard</a>
          <button onclick="logoutUser()" class="btn btn-sm btn-danger">Logout</button>
        </div>
      `;
    } else {
      const roll = user.rollNumber || user.registerNumber || '';
      if (navLinksContainer) {
        navLinksContainer.innerHTML = `
          <li><a href="student-dashboard.html" class="nav-link ${currentPath.includes('student-dashboard') ? 'active' : ''}">My Dashboard</a></li>
          <li><a href="events.html" class="nav-link ${currentPath.includes('events') ? 'active' : ''}">Browse Events</a></li>
          <li><a href="my-registration.html" class="nav-link ${currentPath.includes('my-registration') ? 'active' : ''}">Find My Pass</a></li>
        `;
      }
      navContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="badge badge-present">
            ${user.name || 'Student'} (${roll})
          </span>
          <a href="student-dashboard.html" class="btn btn-primary btn-sm">My Passes</a>
          <button onclick="logoutUser()" class="btn btn-sm btn-outline">Logout</button>
        </div>
      `;
    }
  } else {
    if (navLinksContainer) {
      navLinksContainer.innerHTML = `
        <li><a href="index.html" class="nav-link ${currentPath.endsWith('index.html') || currentPath === '/' ? 'active' : ''}">Home</a></li>
        <li><a href="events.html" class="nav-link ${currentPath.includes('events') ? 'active' : ''}">Upcoming Events</a></li>
        <li><a href="my-registration.html" class="nav-link ${currentPath.includes('my-registration') ? 'active' : ''}">Find My Pass</a></li>
        <li><a href="register.html" class="nav-link ${currentPath.includes('register.html') ? 'active' : ''}">Register</a></li>
      `;
    }
    navContainer.innerHTML = `
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <a href="login.html" class="btn btn-primary btn-sm">Sign In</a>
      </div>
    `;
  }
}

// Universal Toast Utility
function showToast(message, type = 'info', duration = 3500) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

document.addEventListener('DOMContentLoaded', setupNavbar);
