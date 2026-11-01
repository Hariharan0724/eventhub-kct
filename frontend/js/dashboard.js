/**
 * EventHub - Organizer Dashboard & Participant Management Controller
 */

// Initialize Dashboard Page (organizer-dashboard.html)
async function initOrganizerDashboard() {
  const eventsTableBody = document.getElementById('dashboard-events-body');
  if (!eventsTableBody) return;

  if (!requireOrganizerAuth()) return;

  const user = getCurrentUser();
  if (user) {
    const orgNameEl = document.getElementById('sidebar-org-name');
    if (orgNameEl) orgNameEl.textContent = user.name || 'EventHub Organizer';

    if (user.role === 'admin') {
      const adminLink = document.getElementById('link-admin-panel');
      const adminSection = document.getElementById('admin-section-title');
      if (adminLink) adminLink.style.display = 'flex';
      if (adminSection) adminSection.style.display = 'block';
    }
  }

  await loadDashboardMetrics();
  await loadDashboardAnalytics();
  initLiveAttendanceFeed();
  setupCreateEventModal();
}

function openCreateModal() {
  const modal = document.getElementById('create-event-modal');
  if (modal) {
    modal.classList.add('show');
    modal.style.display = 'flex';
  }
}

function closeCreateModal() {
  const modal = document.getElementById('create-event-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

// Fetch aggregate dashboard metrics and event list
async function loadDashboardMetrics() {
  const eventsTableBody = document.getElementById('dashboard-events-body');
  if (!eventsTableBody) return;

  try {
    const [statsRes, allEventsRes] = await Promise.all([
      fetch('/api/dashboard/stats', { headers: getAuthHeaders() }),
      fetch('/api/events/all', { headers: getAuthHeaders() })
    ]);

    const statsData = await statsRes.json();
    const allEventsData = await allEventsRes.json();

    if (!statsData.success) {
      showToast('Failed to load dashboard metrics', 'error');
      return;
    }

    const { stats, recentCheckIns } = statsData;
    const events = allEventsData.success ? (allEventsData.data || []) : (statsData.events || []);

    // Check for pending approvals
    const pendingEvents = events.filter(e => e.approvalStatus === 'pending');
    const pendingBadge = document.getElementById('pending-badge-count');
    const pendingAlertStrip = document.getElementById('pending-approvals-alert-strip');

    if (pendingEvents.length > 0) {
      if (pendingBadge) {
        pendingBadge.textContent = pendingEvents.length;
        pendingBadge.style.display = 'inline-block';
      }
      if (pendingAlertStrip) {
        pendingAlertStrip.style.display = 'flex';
      }
    } else {
      if (pendingBadge) pendingBadge.style.display = 'none';
      if (pendingAlertStrip) pendingAlertStrip.style.display = 'none';
    }

    // Render Stat Cards
    document.getElementById('stat-total-events').textContent = events.length;
    document.getElementById('stat-total-registrations').textContent = stats.totalRegistrations || 0;
    document.getElementById('stat-total-present').textContent = stats.totalPresent || 0;
    document.getElementById('stat-attendance-rate').textContent = `${stats.attendanceRate}%`;

    // Render Events Table
    if (events.length === 0) {
      eventsTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding: 2.5rem; color: #64748b;">
            No campus events found. Click "+ New Event" to schedule an event.
          </td>
        </tr>
      `;
      return;
    }

    const token = getAuthToken() || '';
    eventsTableBody.innerHTML = events.map(evt => {
      const formattedDate = new Date(evt.date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      const registered = evt.registeredCount || evt.registered || 0;
      const present = evt.presentCount || evt.present || 0;
      const absent = Math.max(0, registered - present);
      const rate = evt.attendanceRate || (registered > 0 ? ((present / registered) * 100).toFixed(1) : '0.0');

      let statusBadge = '';
      const status = evt.approvalStatus || 'approved';
      if (status === 'approved') {
        statusBadge = `<span class="approval-badge approved"><i class="fas fa-check"></i> Approved</span>`;
      } else if (status === 'rejected') {
        statusBadge = `<span class="approval-badge rejected"><i class="fas fa-times"></i> Rejected</span>`;
      } else {
        statusBadge = `<span class="approval-badge pending"><i class="fas fa-clock"></i> Pending</span>`;
      }

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 1rem 1.25rem;">
            <strong style="color: #1e1b4b; font-size: 0.95rem;">${evt.name}</strong><br>
            <span style="font-size: 0.78rem; color: #64748b;">${evt.category || 'General'} &bull; By ${evt.createdByName || evt.organizer || 'Faculty'}</span>
          </td>
          <td style="padding: 1rem;">
            <div style="font-size: 0.88rem; font-weight: 500;">${formattedDate}</div>
            <div style="font-size: 0.78rem; color: #64748b;">${evt.venue}</div>
          </td>
          <td style="padding: 1rem; text-align: center;">${statusBadge}</td>
          <td style="padding: 1rem; text-align: center; font-weight: 600;">${registered} / ${evt.capacity}</td>
          <td style="padding: 1rem; text-align: center;"><span class="badge badge-present">${present}</span></td>
          <td style="padding: 1rem; text-align: center; font-weight: 700; color: #6d28d9;">${rate}%</td>
          <td style="padding: 1rem 1.25rem; text-align: right;">
            <div style="display: flex; gap: 0.4rem; justify-content: flex-end; flex-wrap: wrap;">
              ${status === 'approved' ? `
                <a href="attendance.html?eventId=${evt.id}" class="btn btn-primary btn-sm" title="Scan QR and Mark Attendance">
                  <i class="fas fa-camera"></i> Scan
                </a>
                <button onclick="openSessionMatrixModal('${evt.id}', '${evt.name.replace(/'/g, "\\'")}')" class="btn btn-outline btn-sm" style="color:#0284c7; border-color:#38bdf8;" title="Multi-Session Track Matrix">
                  <i class="fas fa-timeline"></i> Sessions
                </button>
                <button onclick="openEventFeedbackAnalyticsModal('${evt.id}', '${evt.name.replace(/'/g, "\\'")}')" class="btn btn-outline btn-sm" style="color:#7c3aed; border-color:#8b5cf6;" title="Attendee Feedback & Satisfaction Analytics">
                  <i class="fas fa-star"></i> Feedback
                </button>
                <a href="academic-roster.html?eventId=${evt.id}" class="btn btn-outline btn-sm" style="color:#b45309; border-color:#f59e0b;" title="Official Academic Roster (Print / Clearance)">
                  <i class="fas fa-file-invoice"></i> Roster
                </a>
                <a href="participants.html?eventId=${evt.id}" class="btn btn-outline btn-sm" title="View Participants List">
                  <i class="fas fa-users"></i>
                </a>
                <a href="/api/events/${evt.id}/export-csv?token=${encodeURIComponent(token)}" class="btn btn-outline btn-sm" title="Download Attendance CSV">
                  <i class="fas fa-file-csv"></i>
                </a>
              ` : `
                <a href="event-approvals.html" class="btn btn-outline btn-sm">
                  Review
                </a>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Render Recent Check-ins
    const recentList = document.getElementById('dashboard-recent-checkins');
    if (recentList && recentCheckIns) {
      if (recentCheckIns.length === 0) {
        recentList.innerHTML = `<p style="color:#64748b; padding:1rem; text-align:center;">No recent check-ins recorded yet.</p>`;
      } else {
        recentList.innerHTML = recentCheckIns.map(r => {
          const time = new Date(r.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const roll = r.rollNumber || r.registerNumber || '';
          return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:0.65rem 0; border-bottom:1px solid #f1f5f9;">
              <div>
                <strong style="color: #1e1b4b;">${r.studentName}</strong> 
                <span class="user-roll-badge" style="margin-left: 4px;">${roll}</span>
                <div style="font-size:0.75rem; color:#64748b; margin-top: 2px;">${r.eventName}</div>
              </div>
              <span class="badge badge-present"><i class="fas fa-check"></i> ${time}</span>
            </div>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.error('Error loading dashboard stats:', err);
    showToast('Network error loading dashboard', 'error');
  }
}

// Setup Create Event Modal
function setupCreateEventModal() {
  const form = document.getElementById('create-event-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');

    const payload = {
      name: document.getElementById('evt-name').value.trim(),
      category: document.getElementById('evt-category').value,
      date: document.getElementById('evt-date').value,
      time: document.getElementById('evt-time').value.trim(),
      venue: document.getElementById('evt-venue').value.trim(),
      capacity: parseInt(document.getElementById('evt-capacity').value, 10),
      description: document.getElementById('evt-description').value.trim()
    };

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message || 'Event submitted successfully!', 'success');
        closeCreateModal();
        form.reset();
        await loadDashboardMetrics();
      } else {
        showToast(data.message || 'Failed to submit event', 'error');
      }
    } catch (err) {
      console.error('Error submitting event:', err);
      showToast('Network error while submitting event', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Event';
    }
  });
}

// =========================================================================
// Participant Management Page Controller (participants.html)
// =========================================================================
let currentParticipants = [];

async function initParticipantsPage() {
  const tableBody = document.getElementById('participants-table-body');
  if (!tableBody) return;

  if (!requireOrganizerAuth()) return;

  const user = getCurrentUser();
  if (user && user.role === 'admin') {
    const adminLink = document.getElementById('link-admin-panel');
    const adminSection = document.getElementById('admin-section-title');
    if (adminLink) adminLink.style.display = 'flex';
    if (adminSection) adminSection.style.display = 'block';
  }

  const urlParams = new URLSearchParams(window.location.search);
  let eventId = urlParams.get('eventId');
  const eventSelector = document.getElementById('part-event-select');

  try {
    const res = await fetch('/api/events/all', { headers: getAuthHeaders() });
    const data = await res.json();

    if (data.success && data.data && data.data.length > 0) {
      eventSelector.innerHTML = '';
      data.data.forEach(evt => {
        const opt = document.createElement('option');
        opt.value = evt.id;
        opt.textContent = `${evt.name} (${evt.date})`;
        eventSelector.appendChild(opt);
      });

      if (!eventId) {
        eventId = data.data[0].id;
      }
      eventSelector.value = eventId;

      await loadParticipantsForEvent(eventId);

      eventSelector.addEventListener('change', async (e) => {
        eventId = e.target.value;
        const newUrl = `${window.location.pathname}?eventId=${eventId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        await loadParticipantsForEvent(eventId);
      });
    }
  } catch (err) {
    console.error('Error initializing participants page:', err);
  }

  const searchInput = document.getElementById('part-search');
  const deptSelect = document.getElementById('part-dept-filter');
  const statusSelect = document.getElementById('part-status-filter');

  if (searchInput) searchInput.addEventListener('input', filterAndRenderParticipants);
  if (deptSelect) deptSelect.addEventListener('change', filterAndRenderParticipants);
  if (statusSelect) statusSelect.addEventListener('change', filterAndRenderParticipants);
}

async function loadParticipantsForEvent(eventId) {
  const tableBody = document.getElementById('participants-table-body');
  if (!tableBody) return;

  try {
    const res = await fetch(`/api/events/${eventId}/participants`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();

    if (!result.success) {
      showToast('Failed to load participants', 'error');
      return;
    }

    currentParticipants = result.data || [];

    const headerTitle = document.getElementById('report-event-title');
    const headerMeta = document.getElementById('report-event-meta');
    const chipTotal = document.getElementById('chip-total');
    const chipPresent = document.getElementById('chip-present');
    const chipAbsent = document.getElementById('chip-absent');
    const chipRate = document.getElementById('chip-rate');
    const exportBtn = document.getElementById('btn-export-csv');
    const academicRosterBtn = document.getElementById('btn-academic-roster');
    const takeAttendanceBtn = document.getElementById('btn-take-attendance');

    const token = getAuthToken() || '';
    if (headerTitle) headerTitle.textContent = result.event.name;
    if (headerMeta) headerMeta.textContent = `Date: ${result.event.date} • Venue: ${result.event.venue}`;
    if (chipTotal) chipTotal.textContent = result.stats.totalRegistered;
    if (chipPresent) chipPresent.textContent = result.stats.totalPresent;
    if (chipAbsent) chipAbsent.textContent = result.stats.totalAbsent;
    if (chipRate) chipRate.textContent = `${result.stats.attendanceRate}%`;
    if (exportBtn) exportBtn.href = `/api/events/${eventId}/export-csv?token=${encodeURIComponent(token)}`;
    if (academicRosterBtn) academicRosterBtn.href = `academic-roster.html?eventId=${eventId}`;
    if (takeAttendanceBtn) takeAttendanceBtn.href = `attendance.html?eventId=${eventId}`;

    filterAndRenderParticipants();
  } catch (err) {
    console.error('Error fetching participants:', err);
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--danger);">Error loading participants</td></tr>`;
  }
}

function filterAndRenderParticipants() {
  const tableBody = document.getElementById('participants-table-body');
  if (!tableBody) return;

  const searchInput = document.getElementById('part-search');
  const deptSelect = document.getElementById('part-dept-filter');
  const statusSelect = document.getElementById('part-status-filter');

  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const dept = deptSelect ? deptSelect.value : 'all';
  const status = statusSelect ? statusSelect.value : 'all';

  let list = currentParticipants.filter(p => {
    const roll = (p.rollNumber || p.registerNumber || '').toLowerCase();
    const matchQuery = !query ||
      (p.studentName && p.studentName.toLowerCase().includes(query)) ||
      roll.includes(query) ||
      (p.registrationId && p.registrationId.toLowerCase().includes(query)) ||
      (p.email && p.email.toLowerCase().includes(query));

    const matchDept = dept === 'all' || p.department === dept;

    let matchStatus = true;
    if (status === 'Present') matchStatus = p.attendanceStatus === 'Present';
    if (status === 'Absent') matchStatus = p.attendanceStatus !== 'Present';

    return matchQuery && matchDept && matchStatus;
  });

  if (list.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:2.5rem; color:#64748b;">
          No participants match your criteria.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = list.map((p, idx) => {
    const isPresent = p.attendanceStatus === 'Present';
    const checkInFormatted = p.checkInTime ? new Date(p.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Not Checked In';
    const roll = p.rollNumber || p.registerNumber || 'N/A';

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 0.85rem 1rem;"><strong>${idx + 1}</strong></td>
        <td style="padding: 0.85rem 1rem;">
          <strong style="color: #1e1b4b;">${p.studentName}</strong><br>
          <span style="font-size:0.75rem; color:#64748b;">${p.email}</span>
        </td>
        <td style="padding: 0.85rem 1rem;"><span class="user-roll-badge">${roll}</span></td>
        <td style="padding: 0.85rem 1rem;">
          <span style="font-size:0.82rem; font-weight: 500;">${p.department}</span><br>
          <span style="font-size:0.75rem; color:#64748b;">${p.year}</span>
        </td>
        <td style="padding: 0.85rem 1rem;"><span style="color:#6d28d9; font-family:monospace; font-size: 0.85rem;">${p.registrationId}</span></td>
        <td style="padding: 0.85rem 1rem; text-align: center;">
          <span class="badge ${isPresent ? 'badge-present' : 'badge-absent'}">
            ${isPresent ? 'Present' : 'Absent'}
          </span>
        </td>
        <td style="padding: 0.85rem 1rem; font-size: 0.82rem; color: ${isPresent ? '#065f46' : '#64748b'};">${checkInFormatted}</td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <button onclick="toggleStudentAttendance('${p.registrationId}')" class="btn btn-sm ${isPresent ? 'btn-outline' : 'btn-success'}" style="font-size:0.75rem; padding:0.25rem 0.6rem;">
            ${isPresent ? 'Mark Absent' : 'Mark Present'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleStudentAttendance(registrationId) {
  try {
    const res = await fetch('/api/attendance/toggle', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ registrationId })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      const urlParams = new URLSearchParams(window.location.search);
      const eventSelector = document.getElementById('part-event-select');
      const eventId = urlParams.get('eventId') || (eventSelector ? eventSelector.value : null);
      if (eventId) {
        await loadParticipantsForEvent(eventId);
      }
    } else {
      showToast(data.message || 'Failed to update status', 'error');
    }
  } catch (err) {
    console.error('Error toggling attendance:', err);
    showToast('Failed to update status', 'error');
  }
}

/**
 * Load Department & Academic Year Attendance Analytics
 */
async function loadDashboardAnalytics() {
  const deptContainer = document.getElementById('analytics-department-list');
  const yearContainer = document.getElementById('analytics-year-list');
  if (!deptContainer && !yearContainer) return;

  try {
    const res = await fetch('/api/dashboard/analytics', {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (!res.ok || !json.success) return;

    const { departmentBreakdown, yearBreakdown } = json.data;

    // Render Department Breakdown
    if (deptContainer && departmentBreakdown) {
      if (departmentBreakdown.length === 0) {
        deptContainer.innerHTML = `<p style="color:#64748b; text-align:center; padding:1rem;">No department attendance records yet.</p>`;
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

    // Render Academic Year Distribution
    if (yearContainer && yearBreakdown) {
      yearContainer.innerHTML = yearBreakdown.map(y => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; text-align: center;">
          <div style="font-size: 0.78rem; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em;">${y.year}</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #1e1b4b; margin: 0.25rem 0;">${y.attendanceRate}%</div>
          <div style="font-size: 0.75rem; color: #059669; font-weight: 600;">${y.totalPresent} Attended / ${y.totalRegistered} Reg</div>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Error loading dashboard analytics:', err);
  }
}

/**
 * Initialize Server-Sent Events (SSE) Live Entrance Scan Stream
 */
let liveEventSource = null;
function initLiveAttendanceFeed() {
  if (typeof EventSource === 'undefined') return;

  const badge = document.getElementById('live-stream-badge');
  const recentList = document.getElementById('dashboard-recent-checkins');

  if (liveEventSource) {
    liveEventSource.close();
  }

  liveEventSource = new EventSource('/api/attendance/live-stream');

  liveEventSource.onopen = () => {
    if (badge) {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#065f46';
      badge.style.borderColor = '#a7f3d0';
      badge.innerHTML = `<span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block;"></span> LIVE GATE FEED`;
    }
  };

  liveEventSource.onerror = () => {
    if (badge) {
      badge.style.background = '#fef2f2';
      badge.style.color = '#991b1b';
      badge.style.borderColor = '#fecaca';
      badge.innerHTML = `<span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span> RECONNECTING...`;
    }
  };

  liveEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'CONNECTED') return;

      if (data.type === 'CHECK_IN' || data.type === 'STATUS_TOGGLED' || data.type === 'ATTENDANCE_CORRECTED') {
        // Increment present count on dashboard
        const statPresent = document.getElementById('stat-total-present');
        if (statPresent && data.updatedStats) {
          statPresent.textContent = data.updatedStats.totalPresent;
          const statRate = document.getElementById('stat-attendance-rate');
          if (statRate) statRate.textContent = `${data.updatedStats.attendanceRate}%`;
        }

        // Prepend check-in to live feed list
        if (recentList && data.studentName) {
          const item = document.createElement('div');
          item.className = 'recent-checkin-item';
          item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1rem; border-bottom: 1px solid #f1f5f9; background: #f0fdf4; border-left: 4px solid #10b981; margin-bottom: 4px; border-radius: 6px;';
          item.innerHTML = `
            <div>
              <div style="font-weight: 700; color: #1e1b4b; font-size: 0.92rem;">
                ${data.studentName}
                <span class="user-roll-badge" style="font-size: 0.72rem; padding: 2px 6px; margin-left: 6px;">${data.rollNumber || 'KCT'}</span>
              </div>
              <div style="font-size: 0.78rem; color: #065f46; font-weight: 600;">
                <i class="fas fa-circle-check" style="color: #10b981;"></i> Scanned Entrance: ${data.eventName || 'Campus Event'}
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.75rem; color: #059669; font-weight: 700; background: #d1fae5; padding: 2px 8px; border-radius: 4px;">JUST NOW</span>
            </div>
          `;

          if (recentList.querySelector('p')) {
            recentList.innerHTML = '';
          }
          recentList.prepend(item);
        }

        if (typeof showToast === 'function' && data.studentName) {
          showToast(`⚡ Entrance Check-in: ${data.studentName} (${data.rollNumber})`, 'success');
        }

        // Refresh analytics in background
        loadDashboardAnalytics();
      }
    } catch (e) {
      console.error('Error processing SSE live feed message:', e);
    }
  };
}

// ==========================================
// EVENT FEEDBACK ANALYTICS (FEATURE 2)
// ==========================================
async function openEventFeedbackAnalyticsModal(eventId, eventName) {
  const modal = document.getElementById('event-feedback-modal');
  if (!modal) return;

  document.getElementById('feedback-analytics-event-title').textContent = eventName;
  const listEl = document.getElementById('feedback-reviews-list');
  listEl.innerHTML = '<p style="color:#64748b; text-align:center; padding:2rem;"><i class="fas fa-spinner fa-spin"></i> Loading participant feedback...</p>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/feedback/event/${eventId}`, { headers: getAuthHeaders() });
    const json = await res.json();

    if (!res.ok || !json.success) {
      listEl.innerHTML = `<p style="color:#ef4444; text-align:center; padding:2rem;">Failed to load feedback.</p>`;
      return;
    }

    const { summary, reviews } = json;
    document.getElementById('fb-metric-avg-overall').textContent = `${summary.avgOverall} ★`;
    document.getElementById('fb-metric-total-count').textContent = `${summary.totalResponses} Verified Reviews`;
    document.getElementById('fb-metric-recommend').textContent = `${summary.recommendPercentage}%`;
    document.getElementById('fb-metric-subratings').textContent = `${summary.avgContent} / ${summary.avgOrganization}`;

    if (reviews.length === 0) {
      listEl.innerHTML = '<p style="color:#64748b; text-align:center; padding:2rem;">No feedback submitted for this event yet.</p>';
      return;
    }

    listEl.innerHTML = reviews.map(r => {
      const timeFormatted = new Date(r.submittedAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
      return `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <div>
              <strong style="color: #1e1b4b; font-size: 0.9rem;">${r.studentName}</strong>
              <span class="user-roll-badge" style="font-size: 0.72rem; padding: 2px 6px; margin-left: 6px;">${r.rollNumber}</span>
              <span style="font-size: 0.75rem; color: #64748b; margin-left: 6px;">&bull; ${r.department}</span>
            </div>
            <div style="color: #f59e0b; font-weight: 700; font-size: 0.88rem;">
              ${'★'.repeat(r.overallRating)}${'☆'.repeat(5 - r.overallRating)} (${r.overallRating}/5)
            </div>
          </div>
          ${r.comments ? `<p style="font-size: 0.85rem; color: #334155; margin: 0.35rem 0; font-style: italic;">"${r.comments}"</p>` : '<p style="font-size: 0.8rem; color: #94a3b8; margin: 0.2rem 0; font-style: italic;">No written comments provided.</p>'}
          <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b; margin-top: 0.25rem;">
            <span>${r.wouldRecommend ? '<span style="color:#16a34a; font-weight:600;"><i class="fas fa-thumbs-up"></i> Would Recommend</span>' : '<span style="color:#b91c1c;">Did Not Recommend</span>'}</span>
            <span>${timeFormatted}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error fetching feedback:', err);
    listEl.innerHTML = `<p style="color:#ef4444; text-align:center; padding:2rem;">Network error connecting to feedback service.</p>`;
  }
}

function closeEventFeedbackAnalyticsModal() {
  const modal = document.getElementById('event-feedback-modal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// MULTI-SESSION ATTENDANCE MATRIX (FEATURE 3)
// ==========================================
async function openSessionMatrixModal(eventId, eventName) {
  const modal = document.getElementById('event-sessions-modal');
  if (!modal) return;

  document.getElementById('sessions-modal-event-title').textContent = eventName;
  const bodyEl = document.getElementById('session-matrix-body');
  bodyEl.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #64748b;"><i class="fas fa-spinner fa-spin"></i> Loading session attendance grid...</td></tr>';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/events/${eventId}/session-matrix`, { headers: getAuthHeaders() });
    const json = await res.json();

    if (!res.ok || !json.success) {
      bodyEl.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #ef4444;">Failed to load session matrix.</td></tr>`;
      return;
    }

    const { sessions, matrix } = json;

    const sessionsDisplay = document.getElementById('sessions-list-display');
    if (sessionsDisplay) {
      sessionsDisplay.textContent = sessions.map(s => `${s.sessionId} (${s.name})`).join(' • ');
    }

    if (matrix.length === 0) {
      bodyEl.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #64748b;">No registered students found for this event.</td></tr>';
      return;
    }

    bodyEl.innerHTML = matrix.map(m => {
      const isPresent = m.overallStatus === 'Present';
      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 0.75rem 1rem;"><span class="user-roll-badge">${m.rollNumber}</span></td>
          <td style="padding: 0.75rem 1rem;">
            <strong style="color: #1e1b4b;">${m.studentName}</strong><br>
            <span style="font-size: 0.75rem; color: #64748b;">${m.department}</span>
          </td>
          <td style="padding: 0.75rem 1rem; text-align: center;">
            <span style="font-weight: 700; color: #6d28d9;">${m.attendedCount} / ${m.totalSessions}</span>
            <span style="font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${m.attendancePercentage}%)</span>
          </td>
          <td style="padding: 0.75rem 1rem; text-align: center;">
            <span class="badge ${isPresent ? 'badge-present' : 'badge-absent'}">
              ${isPresent ? '<i class="fas fa-check"></i> Cleared Present' : 'Incomplete'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error fetching session matrix:', err);
    bodyEl.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: #ef4444;">Network error fetching session matrix.</td></tr>';
  }
}

function closeSessionMatrixModal() {
  const modal = document.getElementById('event-sessions-modal');
  if (modal) modal.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  initOrganizerDashboard();
  initParticipantsPage();
});
