/**
 * EventHub - Comprehensive Administrator Console Controller (Panel 9)
 * Manages System Overview, Student & Organizer lifecycle, Roll Number edits,
 * Attendance Corrections with mandatory justification reasons, and Audit Logs.
 */

let currentAdminTab = 'overview';
let allStudentsList = [];
let allOrganizersList = [];
let allAttendanceRecords = [];
let allAuditLogs = [];

let isRedirectingToAdminLogin = false;
function handleUnauthorizedAdmin() {
  if (isRedirectingToAdminLogin) return;
  isRedirectingToAdminLogin = true;
  showToast('Administrator privileges required. Redirecting to admin sign in...', 'error');
  setTimeout(() => {
    window.location.href = 'login.html?role=admin&auth=required';
  }, 1200);
}

// Initialize Admin Console
async function initAdminConsole() {
  if (!requireAdminAuth()) return;

  const user = getCurrentUser();
  if (user) {
    const adminNameEl = document.getElementById('sidebar-admin-name');
    if (adminNameEl) adminNameEl.textContent = user.name || 'System Administrator';
  }

  setupStudentModal();
  setupOrganizerModal();
  setupCorrectionForm();
  setupSearchListeners();
  setupModalDismissHandlers();

  try {
    await loadAdminOverview();
    await loadAdminAnalytics();
    initAdminLiveFeed();
  } catch (err) {
    console.error('Error on initial admin overview load:', err);
  }
}

function setupModalDismissHandlers() {
  ['student-modal', 'organizer-modal', 'correction-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          el.classList.remove('show');
          el.style.display = 'none';
        }
      });
    }
  });
}

function refreshCurrentAdminView() {
  if (currentAdminTab === 'overview') loadAdminOverview();
  else if (currentAdminTab === 'students') loadAdminStudents();
  else if (currentAdminTab === 'organizers') loadAdminOrganizers();
  else if (currentAdminTab === 'attendance') loadAdminAttendance();
  else if (currentAdminTab === 'audit-logs') loadAdminAuditLogs();
  else if (currentAdminTab === 'emails') loadAdminEmails();
}

function switchAdminTab(tab) {
  currentAdminTab = tab;

  // Hide all views
  const views = ['overview', 'students', 'organizers', 'attendance', 'audit-logs', 'emails'];
  views.forEach(v => {
    const el = document.getElementById(`admin-view-${v}`);
    if (el) el.style.display = v === tab ? 'block' : 'none';
  });

  // Update sidebar active link
  document.querySelectorAll('.app-sidebar .sidebar-link').forEach(link => {
    const onclickAttr = link.getAttribute('onclick') || '';
    if (onclickAttr.includes(`'${tab}'`)) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  const titles = {
    'overview': { title: 'System Overview & Health', subtitle: 'EventHub Command Center & Aggregate Ratios' },
    'students': { title: 'Student Identity & Enrollment Manager', subtitle: 'Manage student profiles, active status & Roll Numbers' },
    'organizers': { title: 'Faculty & Organizer Management', subtitle: 'Manage departmental coordinators and permissions' },
    'attendance': { title: 'Administrative Attendance Adjustments', subtitle: 'Manual overrides with mandatory justification reasons' },
    'audit-logs': { title: 'Centralized Security Audit Trail', subtitle: 'Immutable log of administrative operations' },
    'emails': { title: 'Automated Email Delivery Engine', subtitle: 'Live audit log of passes, evaluations & attendance emails' }
  };

  const meta = titles[tab] || titles['overview'];
  document.getElementById('admin-view-title').textContent = meta.title;
  document.getElementById('admin-view-subtitle').textContent = meta.subtitle;

  // Load view-specific data
  refreshCurrentAdminView();
}

/**
 * 1. LOAD SYSTEM OVERVIEW & METRICS (PANEL 9 DONUT CHART)
 */
async function loadAdminOverview() {
  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast('Failed to load system metrics', 'error');
      return;
    }

    const { stats, chartData, recentActivities } = data;

    // 4 Stat Cards
    document.getElementById('stat-admin-students').textContent = stats.totalStudents;
    document.getElementById('stat-admin-organizers').textContent = stats.totalOrganizers;
    document.getElementById('stat-admin-events').textContent = stats.totalEvents;
    document.getElementById('stat-admin-approved').textContent = stats.approvedEvents;

    // Donut Chart Visual
    const approved = chartData.eventStatus.approved || 0;
    const pending = chartData.eventStatus.pending || 0;
    const rejected = chartData.eventStatus.rejected || 0;
    const totalEvts = stats.totalEvents || (approved + pending + rejected) || 1;

    const pApproved = Math.round((approved / totalEvts) * 100);
    const pPending = Math.round((pending / totalEvts) * 100);
    const pRejected = 100 - pApproved - pPending;

    const donutEl = document.getElementById('event-donut-visual');
    if (donutEl) {
      donutEl.style.background = `conic-gradient(#10b981 0% ${pApproved}%, #f59e0b ${pApproved}% ${pApproved + pPending}%, #ef4444 ${pApproved + pPending}% 100%)`;
    }

    document.getElementById('donut-total-count').textContent = stats.totalEvents;
    document.getElementById('legend-approved').textContent = approved;
    document.getElementById('legend-pending').textContent = pending;
    document.getElementById('legend-rejected').textContent = rejected;

    // Recent Activities Feed
    const feedContainer = document.getElementById('overview-recent-activities');
    if (feedContainer && recentActivities) {
      if (recentActivities.length === 0) {
        feedContainer.innerHTML = '<p style="color:#64748b; padding:1rem; text-align:center;">No activities recorded yet.</p>';
      } else {
        feedContainer.innerHTML = recentActivities.map(log => {
          const timeFormatted = new Date(log.timestamp).toLocaleString();
          let icon = 'fas fa-info-circle';
          let color = '#6d28d9';

          if (log.action.includes('APPROVED')) { icon = 'fas fa-check-circle'; color = '#10b981'; }
          else if (log.action.includes('REJECTED')) { icon = 'fas fa-ban'; color = '#ef4444'; }
          else if (log.action.includes('ROLL')) { icon = 'fas fa-id-card'; color = '#f59e0b'; }
          else if (log.action.includes('CORRECTED')) { icon = 'fas fa-file-pen'; color = '#8b5cf6'; }

          return `
            <div style="display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.65rem; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: white; color: ${color}; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); flex-shrink: 0;">
                <i class="${icon}"></i>
              </div>
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong style="font-size: 0.85rem; color: #1e1b4b;">${log.action.replace(/_/g, ' ')}</strong>
                  <span style="font-size: 0.72rem; color: #64748b;">${timeFormatted}</span>
                </div>
                <div style="font-size: 0.78rem; color: #475569; margin-top: 2px;">
                  Actor: <code>${log.actorRole}</code> &bull; Target: <code>${log.targetId}</code>
                  ${log.reason ? ` &bull; <em>Reason: ${log.reason}</em>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.error('Error loading admin overview:', err);
  }
}

/**
 * 2. STUDENT MANAGER
 */
async function loadAdminStudents() {
  const tbody = document.getElementById('admin-students-table-body');
  if (!tbody) return;

  const search = document.getElementById('admin-student-search') ? document.getElementById('admin-student-search').value.trim() : '';
  const status = document.getElementById('admin-student-status-filter') ? document.getElementById('admin-student-status-filter').value : 'all';

  try {
    const res = await fetch(`/api/admin/students?search=${encodeURIComponent(search)}&status=${status}`, {
      headers: getAuthHeaders()
    });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load students', 'error');
      return;
    }

    allStudentsList = data.data || [];

    if (allStudentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:#64748b;">No students found matching query.</td></tr>`;
      return;
    }

    tbody.innerHTML = allStudentsList.map(stu => {
      const roll = stu.rollNumber || stu.registerNumber || 'N/A';
      const isActive = (stu.accountStatus || 'active') === 'active';

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 1rem 1.25rem;">
            <span class="user-roll-badge" style="font-size: 0.88rem; font-weight: bold;">${roll}</span>
          </td>
          <td style="padding: 1rem;">
            <strong style="color: #1e1b4b;">${stu.name}</strong><br>
            <span style="font-size: 0.78rem; color: #64748b;">${stu.email}</span>
          </td>
          <td style="padding: 1rem;">
            <span style="font-size: 0.85rem; font-weight: 500;">${stu.department || 'CSE'}</span><br>
            <span style="font-size: 0.75rem; color: #64748b;">${stu.year || '4th Year'}</span>
          </td>
          <td style="padding: 1rem; text-align: center;">
            <span class="badge ${isActive ? 'badge-present' : 'badge-absent'}">
              ${isActive ? 'Active' : 'Deactivated'}
            </span>
          </td>
          <td style="padding: 1rem 1.25rem; text-align: right;">
            <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
              <button onclick="openEditStudentModal('${stu.id}')" class="btn btn-outline btn-sm" title="Edit Student & Roll No.">
                <i class="fas fa-pen-to-square"></i> Edit
              </button>
              <button onclick="toggleStudentStatus('${stu.id}', '${isActive ? 'inactive' : 'active'}')" class="btn btn-sm ${isActive ? 'btn-danger' : 'btn-success'}">
                ${isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading students:', err);
  }
}

function openCreateStudentModal() {
  document.getElementById('student-modal-title').textContent = 'Add Student';
  document.getElementById('modal-student-id').value = '';
  document.getElementById('student-modal-form').reset();
  document.getElementById('student-modal-alert').style.display = 'none';
  const modal = document.getElementById('student-modal');
  modal.classList.add('show');
  modal.style.display = 'flex';
}

function openEditStudentModal(studentId) {
  const stu = allStudentsList.find(s => s.id === studentId || s.userId === studentId);
  if (!stu) {
    console.error('Student not found for id:', studentId);
    showToast('Student record not found in memory.', 'error');
    return;
  }

  document.getElementById('student-modal-title').textContent = 'Edit Student Details & Roll Number';
  document.getElementById('modal-student-id').value = stu.id || studentId;
  document.getElementById('stu-name').value = stu.name || '';
  document.getElementById('stu-roll').value = stu.rollNumber || stu.registerNumber || '';
  document.getElementById('stu-email').value = stu.email || '';
  document.getElementById('stu-dept').value = stu.department || '';
  document.getElementById('stu-year').value = stu.year || '';
  const phoneEl = document.getElementById('stu-phone');
  if (phoneEl) phoneEl.value = stu.phone || '';
  const passEl = document.getElementById('stu-password');
  if (passEl) passEl.value = '';
  document.getElementById('student-modal-alert').style.display = 'none';
  const modal = document.getElementById('student-modal');
  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeStudentModal() {
  const modal = document.getElementById('student-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

function setupStudentModal() {
  const form = document.getElementById('student-modal-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('modal-student-id').value;
    const alertBox = document.getElementById('student-modal-alert');
    const saveBtn = document.getElementById('btn-save-student');

    const payload = {
      name: document.getElementById('stu-name').value.trim(),
      rollNumber: document.getElementById('stu-roll').value.trim().toUpperCase(),
      email: document.getElementById('stu-email').value.trim().toLowerCase(),
      department: document.getElementById('stu-dept').value.trim(),
      year: document.getElementById('stu-year').value.trim()
    };

    const phoneVal = document.getElementById('stu-phone') ? document.getElementById('stu-phone').value.trim() : '';
    if (phoneVal) payload.phone = phoneVal;

    const passVal = document.getElementById('stu-password') ? document.getElementById('stu-password').value.trim() : '';
    if (passVal) payload.password = passVal;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const url = studentId ? `/api/admin/students/${studentId}` : '/api/admin/students';
      const method = studentId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'Student saved successfully!', 'success');
        closeStudentModal();
        await loadAdminStudents();
      } else {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef2f2';
        alertBox.style.border = '1px solid #fecaca';
        alertBox.style.color = '#991b1b';
        alertBox.textContent = data.message || 'Failed to save student.';
      }
    } catch (err) {
      console.error('Error saving student:', err);
      showToast('Network error saving student', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Student';
    }
  });
}

async function toggleStudentStatus(studentId, newStatus) {
  if (!confirm(`Are you sure you want to change student status to ${newStatus}?`)) return;

  try {
    const res = await fetch(`/api/admin/students/${studentId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      await loadAdminStudents();
    } else {
      showToast(data.message || 'Failed to update status', 'error');
    }
  } catch (err) {
    showToast('Network error updating student status', 'error');
  }
}

/**
 * 3. ORGANIZER MANAGER
 */
async function loadAdminOrganizers() {
  const tbody = document.getElementById('admin-organizers-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/organizers', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load organizers', 'error');
      return;
    }

    allOrganizersList = data.data || [];

    if (allOrganizersList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:#64748b;">No organizers found.</td></tr>`;
      return;
    }

    tbody.innerHTML = allOrganizersList.map(org => {
      const isActive = (org.accountStatus || 'active') === 'active';
      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 1rem 1.25rem;">
            <strong style="color: #1e1b4b;">${org.name}</strong><br>
            <span style="font-size: 0.78rem; color: #64748b;">Role: ${org.role.toUpperCase()}</span>
          </td>
          <td style="padding: 1rem;">
            <span style="font-size: 0.85rem; font-weight: 500;">${org.designation || 'Faculty'}</span><br>
            <span style="font-size: 0.75rem; color: #64748b;">${org.institution || 'KCT'}</span>
          </td>
          <td style="padding: 1rem;"><code>${org.email}</code></td>
          <td style="padding: 1rem; text-align: center;">
            <span class="badge ${isActive ? 'badge-present' : 'badge-absent'}">
              ${isActive ? 'Active' : 'Deactivated'}
            </span>
          </td>
          <td style="padding: 1rem 1.25rem; text-align: right;">
            <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
              <button onclick="openEditOrganizerModal('${org.id}')" class="btn btn-outline btn-sm">Edit</button>
              <button onclick="toggleOrganizerStatus('${org.id}', '${isActive ? 'inactive' : 'active'}')" class="btn btn-sm ${isActive ? 'btn-danger' : 'btn-success'}">
                ${isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading organizers:', err);
  }
}

function openCreateOrganizerModal() {
  document.getElementById('organizer-modal-title').textContent = 'Add Faculty Organizer';
  document.getElementById('modal-org-id').value = '';
  document.getElementById('organizer-modal-form').reset();
  document.getElementById('organizer-modal-alert').style.display = 'none';
  const modal = document.getElementById('organizer-modal');
  modal.classList.add('show');
  modal.style.display = 'flex';
}

function openEditOrganizerModal(orgId) {
  const org = allOrganizersList.find(o => o.id === orgId || o.userId === orgId);
  if (!org) {
    console.error('Organizer not found for id:', orgId);
    showToast('Organizer record not found in memory.', 'error');
    return;
  }

  document.getElementById('organizer-modal-title').textContent = 'Edit Organizer Details';
  document.getElementById('modal-org-id').value = org.id || orgId;
  document.getElementById('org-name').value = org.name || '';
  document.getElementById('org-email').value = org.email || '';
  document.getElementById('org-desig').value = org.designation || '';
  const orgPassEl = document.getElementById('org-password');
  if (orgPassEl) orgPassEl.value = '';
  document.getElementById('organizer-modal-alert').style.display = 'none';
  const modal = document.getElementById('organizer-modal');
  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeOrganizerModal() {
  const modal = document.getElementById('organizer-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

function setupOrganizerModal() {
  const form = document.getElementById('organizer-modal-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgId = document.getElementById('modal-org-id').value;
    const saveBtn = document.getElementById('btn-save-organizer');
    const alertBox = document.getElementById('organizer-modal-alert');

    const payload = {
      name: document.getElementById('org-name').value.trim(),
      email: document.getElementById('org-email').value.trim().toLowerCase(),
      designation: document.getElementById('org-desig').value.trim()
    };

    const passVal = document.getElementById('org-password') ? document.getElementById('org-password').value.trim() : '';
    if (passVal) payload.password = passVal;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const url = orgId ? `/api/admin/organizers/${orgId}` : '/api/admin/organizers';
      const method = orgId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'Organizer saved successfully!', 'success');
        closeOrganizerModal();
        await loadAdminOrganizers();
      } else {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef2f2';
        alertBox.style.border = '1px solid #fecaca';
        alertBox.style.color = '#991b1b';
        alertBox.textContent = data.message || 'Failed to save organizer.';
      }
    } catch (err) {
      console.error('Error saving organizer:', err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Organizer';
    }
  });
}

async function toggleOrganizerStatus(orgId, newStatus) {
  if (!confirm(`Are you sure you want to toggle organizer status to ${newStatus}?`)) return;

  try {
    const res = await fetch(`/api/admin/organizers/${orgId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      await loadAdminOrganizers();
    } else {
      showToast(data.message || 'Failed to update organizer status', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

/**
 * 4. ATTENDANCE CORRECTIONS (MANDATORY REASON)
 */
async function loadAdminAttendance() {
  const tbody = document.getElementById('admin-attendance-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/attendance', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load attendance records', 'error');
      return;
    }

    allAttendanceRecords = data.data || [];

    if (allAttendanceRecords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">No verified attendance records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = allAttendanceRecords.map(rec => {
      const time = rec.timestamp || rec.checkInTime ? new Date(rec.timestamp || rec.checkInTime).toLocaleString() : 'N/A';
      const roll = rec.rollNumberSnapshot || 'N/A';

      const isPresent = rec.status === 'Present';
      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 1rem 1.25rem;">
            <strong style="color: #1e1b4b;">${rec.eventName || rec.eventId}</strong>
          </td>
          <td style="padding: 1rem;"><strong>${rec.studentName}</strong></td>
          <td style="padding: 1rem;"><span class="user-roll-badge">${roll}</span></td>
          <td style="padding: 1rem; text-align: center;"><span class="badge ${isPresent ? 'badge-present' : 'badge-absent'}">${rec.status}</span></td>
          <td style="padding: 1rem; font-size: 0.85rem; color: #475569;">${time}</td>
          <td style="padding: 1rem 1.25rem; text-align: right;">
            <button onclick="openCorrectionModal('${rec.registrationId}')" class="btn btn-sm btn-outline" style="border-color: #6d28d9; color: #6d28d9;">
              <i class="fas fa-file-pen"></i> Adjust Attendance
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading admin attendance:', err);
  }
}

function openCorrectionModal(regId) {
  const rec = allAttendanceRecords.find(r => r.registrationId === regId || r.id === regId);
  if (!rec) return;

  document.getElementById('corr-reg-id').value = regId;
  document.getElementById('corr-student-name').textContent = rec.studentName || 'Student';
  document.getElementById('corr-roll-no').textContent = rec.rollNumberSnapshot || rec.rollNumber || 'N/A';
  document.getElementById('corr-current-status').textContent = rec.status || 'Registered';
  document.getElementById('corr-reason').value = '';
  const modal = document.getElementById('correction-modal');
  modal.classList.add('show');
  modal.style.display = 'flex';
}

function closeCorrectionModal() {
  const modal = document.getElementById('correction-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

function setupCorrectionForm() {
  const form = document.getElementById('correction-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const registrationId = document.getElementById('corr-reg-id').value;
    const targetStatus = document.getElementById('corr-target-status').value;
    const reason = document.getElementById('corr-reason').value.trim();
    const submitBtn = document.getElementById('btn-submit-correction');

    if (!reason) {
      alert('A justification reason is mandatory for administrative attendance adjustments.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Recording Correction...';

    try {
      const res = await fetch('/api/admin/attendance/correct', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ registrationId, targetStatus, reason })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'Attendance corrected and logged to audit trail.', 'success');
        closeCorrectionModal();
        await loadAdminAttendance();
      } else {
        alert(data.message || 'Failed to correct attendance.');
      }
    } catch (err) {
      console.error('Error correcting attendance:', err);
      showToast('Network error correcting attendance', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm & Log to Audit';
    }
  });
}

/**
 * 5. AUDIT LOGS VIEWER
 */
async function loadAdminAuditLogs() {
  const tbody = document.getElementById('admin-audit-table-body');
  if (!tbody) return;

  const actionFilter = document.getElementById('audit-action-filter') ? document.getElementById('audit-action-filter').value : 'all';

  try {
    const res = await fetch(`/api/admin/audit-logs?action=${actionFilter}`, { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load audit logs', 'error');
      return;
    }

    allAuditLogs = data.data || [];

    if (allAuditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:#64748b;">No audit records found matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = allAuditLogs.map(log => {
      const time = new Date(log.timestamp).toLocaleString();
      let badgeStyle = 'background:#f1f5f9; color:#475569;';

      if (log.action.includes('APPROVED')) badgeStyle = 'background:#dcfce7; color:#15803d;';
      else if (log.action.includes('REJECTED')) badgeStyle = 'background:#fee2e2; color:#b91c1c;';
      else if (log.action.includes('ROLL')) badgeStyle = 'background:#fef3c7; color:#b45309;';
      else if (log.action.includes('CORRECTED')) badgeStyle = 'background:#f5f3ff; color:#6d28d9;';

      const detailsStr = log.details ? JSON.stringify(log.details) : '';

      return `
        <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.85rem;">
          <td style="padding: 0.85rem 1.25rem; font-family: monospace; color: #64748b;">${time}</td>
          <td style="padding: 0.85rem 1rem;">
            <span class="badge" style="${badgeStyle}">${log.action}</span>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <strong>${log.actorRole.toUpperCase()}</strong><br>
            <span style="font-size:0.75rem; color:#64748b;">${log.actorId}</span>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <code>${log.targetType}:${log.targetId}</code>
          </td>
          <td style="padding: 0.85rem 1.25rem;">
            ${log.reason ? `<div style="color:#92400e; font-weight:600; margin-bottom:2px;"><i class="fas fa-quote-left" style="font-size:0.75rem; margin-right:4px;"></i>${log.reason}</div>` : ''}
            <div style="font-size: 0.75rem; color: #64748b; font-family: monospace; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${detailsStr}">
              ${detailsStr}
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

function setupSearchListeners() {
  const stuSearch = document.getElementById('admin-student-search');
  const stuStatus = document.getElementById('admin-student-status-filter');
  if (stuSearch) stuSearch.addEventListener('input', loadAdminStudents);
  if (stuStatus) stuStatus.addEventListener('change', loadAdminStudents);
}

/**
 * 6. EMAIL DELIVERY LOGS VIEWER
 */
async function loadAdminEmails() {
  const tbody = document.getElementById('admin-emails-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/emails', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorizedAdmin();
      return;
    }
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load email delivery logs', 'error');
      return;
    }

    const emails = data.data || [];
    if (emails.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2.5rem; color: #64748b;">No email communications dispatched yet.</td></tr>';
      return;
    }

    tbody.innerHTML = emails.map(m => {
      const time = new Date(m.timestamp).toLocaleString();
      let typeBadge = '<span class="badge" style="background:#e0e7ff; color:#4338ca;">PASS DELIVERY</span>';
      if (m.type === 'PROPOSAL_APPROVED') {
        typeBadge = '<span class="badge" style="background:#dcfce7; color:#15803d;">APPROVED</span>';
      } else if (m.type === 'PROPOSAL_DECLINED') {
        typeBadge = '<span class="badge" style="background:#fee2e2; color:#b91c1c;">DECLINED</span>';
      } else if (m.type === 'ATTENDANCE_CONFIRMED') {
        typeBadge = '<span class="badge" style="background:#fef3c7; color:#b45309;">ATTENDANCE</span>';
      }

      return `
        <tr style="border-bottom: 1px solid #f1f5f9; font-size: 0.88rem;">
          <td style="padding: 1rem 1.25rem; font-family: monospace; color: #64748b;">${time}</td>
          <td style="padding: 1rem;">${typeBadge}</td>
          <td style="padding: 1rem;">
            <strong>${m.studentName || m.creatorName || 'Student'}</strong><br>
            <span style="font-size: 0.78rem; color: #64748b; font-family: monospace;">${m.recipient}</span>
          </td>
          <td style="padding: 1rem;">
            <strong style="color: #1e1b4b;">${m.eventName || m.subject}</strong><br>
            ${m.rollNumber ? `<span class="user-roll-badge">${m.rollNumber}</span>` : ''}
            ${m.registrationId ? `<code style="font-size:0.75rem; margin-left:4px;">${m.registrationId}</code>` : ''}
            ${m.rejectionReason ? `<div style="font-size:0.78rem; color:#b91c1c; font-style:italic; margin-top:2px;">Reason: ${m.rejectionReason}</div>` : ''}
          </td>
          <td style="padding: 1rem 1.25rem; text-align: right;">
            <span class="badge badge-success"><i class="fas fa-check-circle"></i> Delivered</span>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading email logs:', err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2.5rem; color: #ef4444;">Error connecting to email log service.</td></tr>';
  }
}

/**
 * Load Campus Analytics in Admin Console
 */
async function loadAdminAnalytics() {
  const deptContainer = document.getElementById('admin-analytics-department-list');
  const yearContainer = document.getElementById('admin-analytics-year-list');
  if (!deptContainer && !yearContainer) return;

  try {
    const res = await fetch('/api/dashboard/analytics', { headers: getAuthHeaders() });
    const json = await res.json();
    if (!res.ok || !json.success) return;

    const { departmentBreakdown, yearBreakdown } = json.data;

    if (deptContainer && departmentBreakdown) {
      if (departmentBreakdown.length === 0) {
        deptContainer.innerHTML = '<p style="color:#64748b; text-align:center; padding:1rem;">No department records found.</p>';
      } else {
        deptContainer.innerHTML = departmentBreakdown.map(d => `
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 4px;">
              <span style="font-weight: 600; color: #1e1b4b;">${d.department}</span>
              <span style="font-weight: 700; color: #6d28d9;">${d.totalPresent} / ${d.totalRegistered} (${d.attendanceRate}%)</span>
            </div>
            <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 9999px; overflow: hidden;">
              <div style="width: ${d.attendanceRate}%; height: 100%; background: linear-gradient(90deg, #6d28d9, #10b981); border-radius: 9999px;"></div>
            </div>
          </div>
        `).join('');
      }
    }

    if (yearContainer && yearBreakdown) {
      yearContainer.innerHTML = yearBreakdown.map(y => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; text-align: center;">
          <div style="font-size: 0.78rem; color: #64748b; text-transform: uppercase; font-weight: 600;">${y.year}</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #1e1b4b; margin: 0.25rem 0;">${y.attendanceRate}%</div>
          <div style="font-size: 0.75rem; color: #059669; font-weight: 600;">${y.totalPresent} Attended / ${y.totalRegistered} Reg</div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error('Error loading admin analytics:', e);
  }
}

/**
 * Initialize SSE Live Gate Scan Feed in Admin Console
 */
let adminLiveSource = null;
function initAdminLiveFeed() {
  if (typeof EventSource === 'undefined') return;

  const badge = document.getElementById('admin-live-stream-badge');
  const list = document.getElementById('admin-live-feed-list');

  if (adminLiveSource) adminLiveSource.close();
  adminLiveSource = new EventSource('/api/attendance/live-stream');

  adminLiveSource.onopen = () => {
    if (badge) {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#065f46';
      badge.style.borderColor = '#a7f3d0';
      badge.innerHTML = `<span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block;"></span> LIVE GATE FEED`;
    }
  };

  adminLiveSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'CONNECTED') return;

      if (data.type === 'CHECK_IN' || data.type === 'STATUS_TOGGLED' || data.type === 'ATTENDANCE_CORRECTED') {
        if (list && data.studentName) {
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #f1f5f9; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 6px;';
          item.innerHTML = `
            <div>
              <div style="font-weight: 700; color: #1e1b4b; font-size: 0.9rem;">
                ${data.studentName}
                <span class="user-roll-badge" style="font-size: 0.72rem; padding: 2px 6px; margin-left: 6px;">${data.rollNumber || 'KCT'}</span>
              </div>
              <div style="font-size: 0.75rem; color: #065f46; font-weight: 600;">
                <i class="fas fa-check-circle" style="color: #10b981;"></i> Entrance Scan: ${data.eventName || 'Campus Event'}
              </div>
            </div>
            <div>
              <span style="font-size: 0.72rem; color: #059669; font-weight: 700; background: #d1fae5; padding: 2px 8px; border-radius: 4px;">JUST NOW</span>
            </div>
          `;
          if (list.querySelector('p')) list.innerHTML = '';
          list.prepend(item);
        }

        loadAdminAnalytics();
      }
    } catch (e) {
      console.error('SSE Error in admin:', e);
    }
  };
}

document.addEventListener('DOMContentLoaded', initAdminConsole);
