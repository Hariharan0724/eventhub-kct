/**
 * EventHub - Student Dashboard Controller
 * Manages metrics, event passes (Panel 7 with visible roll number), event proposals, and submissions
 */

let allStudentPasses = [];
let allSubmissions = [];
let currentFilter = 'all';

// Initialize Student Dashboard
async function initStudentDashboard() {
  if (!requireStudentAuth()) return;

  const user = getCurrentUser();
  if (user) {
    const studentName = user.name || 'Student';
    const rollNo = user.rollNumber || user.registerNumber || '21BCS042';

    // Update avatar circle & sidebar
    const avatarEl = document.getElementById('sidebar-avatar');
    if (avatarEl) avatarEl.textContent = studentName.charAt(0).toUpperCase();

    const sidebarNameEl = document.getElementById('sidebar-student-name');
    if (sidebarNameEl) sidebarNameEl.textContent = studentName;

    const sidebarRollEl = document.getElementById('sidebar-student-roll');
    if (sidebarRollEl) sidebarRollEl.textContent = rollNo;

    const bannerRollEl = document.getElementById('banner-roll-number');
    if (bannerRollEl) bannerRollEl.textContent = rollNo;

    const welcomeName = document.getElementById('student-welcome-name');
    if (welcomeName) welcomeName.textContent = `Welcome, ${studentName}!`;

    const welcomeMeta = document.getElementById('student-welcome-meta');
    if (welcomeMeta) {
      welcomeMeta.textContent = `Roll No: ${rollNo} • Dept: ${user.department || 'Computer Science'} • Year: ${user.year || '4th Year'}`;
    }
  }

  // Load backend data
  await loadStudentStats();
  await loadStudentSubmissions();

  setupFilterButtons();
  setupCreateEventForm();
  setupFeedbackStarListeners();
  setupFeedbackForm();
}

/**
 * Fetch student metrics and registrations
 */
async function loadStudentStats() {
  const container = document.getElementById('student-passes-container');

  try {
    const res = await fetch('/api/dashboard/student-stats', {
      headers: getAuthHeaders()
    });

    if (res.status === 401 || res.status === 403) {
      showToast('Session expired. Please log in again.', 'error');
      logoutUser();
      return;
    }

    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Failed to load dashboard data', 'error');
      return;
    }

    const { stats, registrations } = data;
    allStudentPasses = registrations || [];

    // Render Stat Cards
    document.getElementById('student-stat-registered').textContent = stats.totalRegistered || 0;
    document.getElementById('student-stat-present').textContent = stats.totalAttended || 0;
    document.getElementById('student-stat-pending').textContent = stats.pendingCheckIn || 0;
    document.getElementById('student-stat-rate').textContent = `${stats.attendancePercentage || 0}%`;

    renderStudentPasses();

  } catch (err) {
    console.error('Error fetching student stats:', err);
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0; color: #ef4444;">
          Failed to load passes. Please refresh the page.
        </div>
      `;
    }
  }
}

/**
 * Load events submitted by the student
 */
async function loadStudentSubmissions() {
  const container = document.getElementById('student-submissions-container');
  if (!container) return;

  try {
    const res = await fetch('/api/events/my-submissions', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      allSubmissions = data.data || [];
      renderSubmissions();
    }
  } catch (e) {
    console.error('Error loading submissions:', e);
  }
}

/**
 * Render passes in grid
 */
function renderStudentPasses() {
  const container = document.getElementById('student-passes-container');
  if (!container) return;

  const user = getCurrentUser();
  const userRoll = (user ? (user.rollNumber || user.registerNumber) : '21BCS042') || '21BCS042';

  let filtered = allStudentPasses.filter(pass => {
    if (currentFilter === 'Present') return pass.attendanceStatus === 'Present';
    if (currentFilter === 'Pending') return pass.attendanceStatus !== 'Present';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 2rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0;">
        <i class="fas fa-ticket-simple" style="font-size: 2.5rem; color: #cbd5e1; margin-bottom: 0.75rem;"></i>
        <h4 style="color: #1e1b4b; margin-bottom: 0.35rem;">No Passes Found</h4>
        <p style="color: #64748b; font-size: 0.88rem; max-width: 400px; margin: 0 auto 1.25rem;">
          You don't have any registered events in this category yet. Browse upcoming campus events to register!
        </p>
        <a href="events.html" class="btn btn-primary btn-sm">Explore Campus Events</a>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(pass => {
    const isPresent = pass.attendanceStatus === 'Present';
    const statusBadge = isPresent
      ? `<span class="badge badge-present"><i class="fas fa-check-circle"></i> Verified Present</span>`
      : `<span class="badge badge-registered"><i class="fas fa-clock"></i> Pending Entry Check-in</span>`;

    const rollDisplay = pass.rollNumber || pass.registerNumber || userRoll;

    return `
      <div class="card" style="padding: 1.5rem; border-radius: 14px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: space-between; transition: var(--transition);">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <span class="user-roll-badge" style="font-size: 0.8rem; background: #f5f3ff; color: #6d28d9; border-color: #c4b5fd;">
              ROLL: ${rollDisplay}
            </span>
            ${statusBadge}
          </div>

          <h3 style="font-size: 1.15rem; color: #1e1b4b; margin-bottom: 0.35rem; line-height: 1.3;">
            ${pass.eventName || 'Campus Event'}
          </h3>

          <div style="display: flex; flex-direction: column; gap: 0.35rem; margin: 0.85rem 0; font-size: 0.85rem; color: #64748b;">
            <div><i class="fas fa-calendar-day" style="width: 18px; color: #8b5cf6;"></i> ${pass.eventDate || 'Upcoming'} &bull; ${pass.eventTime || '09:30 AM'}</div>
            <div><i class="fas fa-location-dot" style="width: 18px; color: #8b5cf6;"></i> ${pass.eventVenue || 'KCT Campus'}</div>
          </div>
        </div>

        <div style="display: flex; gap: 0.4rem; margin-top: 1rem; border-top: 1px solid #f1f5f9; padding-top: 1rem; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" style="flex: 1; min-width: 90px;" onclick="viewPassModal('${pass.registrationId}')">
            <i class="fas fa-qrcode" style="margin-right: 4px;"></i> Pass
          </button>
          ${isPresent ? `
            <button class="btn btn-primary btn-sm" style="flex: 1; min-width: 95px; background: #059669; border-color: #059669;" onclick="viewCertificateModal('${pass.registrationId}')">
              <i class="fas fa-award" style="margin-right: 4px;"></i> Certificate
            </button>
            <a href="academic-od.html?regId=${pass.registrationId}" target="_blank" class="btn btn-outline btn-sm" style="flex: 1; min-width: 85px; border-color: #b45309; color: #b45309; text-decoration: none; display: inline-flex; align-items: center; justify-content: center;" title="Academic On-Duty (OD) Slip">
              <i class="fas fa-file-signature" style="margin-right: 4px;"></i> OD Slip
            </a>
            <button class="btn btn-outline btn-sm" style="flex: 1; min-width: 85px; border-color: #7c3aed; color: #7c3aed;" onclick="openFeedbackModal('${pass.eventId}', '${(pass.eventName || 'Campus Event').replace(/'/g, "\\'")}', '${pass.registrationId}')" title="Rate Event & Feedback">
              <i class="fas fa-star" style="margin-right: 4px;"></i> Rate
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render student's submitted events
 */
function renderSubmissions() {
  const container = document.getElementById('student-submissions-container');
  if (!container) return;

  if (allSubmissions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 2rem; background: white; border-radius: 12px; border: 1px solid #e2e8f0;">
        <i class="fas fa-file-circle-plus" style="font-size: 2.5rem; color: #cbd5e1; margin-bottom: 0.75rem;"></i>
        <h4 style="color: #1e1b4b; margin-bottom: 0.35rem;">No Event Submissions</h4>
        <p style="color: #64748b; font-size: 0.88rem; max-width: 400px; margin: 0 auto 1.25rem;">
          Have an idea for a workshop, symposium, or hackathon? Submit your event proposal for campus approval!
        </p>
        <button class="btn btn-primary btn-sm" onclick="openCreateEventModal()">Submit New Event</button>
      </div>
    `;
    return;
  }

  container.innerHTML = allSubmissions.map(evt => {
    let statusBadge = '';
    const status = evt.approvalStatus || 'pending';
    if (status === 'approved') {
      statusBadge = `<span class="approval-badge approved"><i class="fas fa-check"></i> Approved</span>`;
    } else if (status === 'rejected') {
      statusBadge = `<span class="approval-badge rejected"><i class="fas fa-times"></i> Declined</span>`;
    } else {
      statusBadge = `<span class="approval-badge pending"><i class="fas fa-clock"></i> Pending Review</span>`;
    }

    return `
      <div class="card" style="padding: 1.25rem 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem;">
            ${statusBadge}
            <span class="badge" style="background: #f1f5f9; color: #475569;">${evt.category || 'General'}</span>
          </div>
          <h4 style="color: #1e1b4b; margin-bottom: 0.25rem;">${evt.name}</h4>
          <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 0;">
            <i class="fas fa-calendar" style="margin-right: 4px;"></i> ${evt.date} &bull; <i class="fas fa-location-dot" style="margin-right: 4px;"></i> ${evt.venue}
          </p>
          ${evt.rejectionReason ? `
            <div style="margin-top: 0.5rem; background: #fef2f2; border: 1px solid #fecaca; padding: 0.4rem 0.75rem; border-radius: 6px; font-size: 0.8rem; color: #991b1b;">
              <strong>Feedback:</strong> ${evt.rejectionReason}
            </div>
          ` : ''}
        </div>
        <div>
          ${status === 'approved' ? `<span style="font-size: 0.85rem; color: #15803d; font-weight: 600;"><i class="fas fa-globe"></i> Published on Campus Catalog</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Open Panel 7 Digital Pass Modal with College Roll Number prominent display
 */
function viewPassModal(registrationId) {
  const pass = allStudentPasses.find(p => p.registrationId === registrationId);
  if (!pass) return;

  const user = getCurrentUser();
  const studentName = pass.studentName || (user ? user.name : 'Student');
  const rollNumber = pass.rollNumber || pass.registerNumber || (user ? (user.rollNumber || user.registerNumber) : '21BCS042');

  document.getElementById('modal-pass-avatar').textContent = studentName.charAt(0).toUpperCase();
  document.getElementById('modal-student-name').textContent = studentName;
  document.getElementById('modal-roll-number').textContent = rollNumber;
  document.getElementById('modal-event-title').textContent = pass.eventName || 'Campus Event';
  document.getElementById('modal-event-category').textContent = pass.department || 'Technical';
  document.getElementById('modal-event-datetime').textContent = `${pass.eventDate || 'Upcoming'} • ${pass.eventTime || '09:30 AM'}`;
  document.getElementById('modal-event-venue').textContent = pass.eventVenue || 'KCT Campus';

  const isPresent = pass.attendanceStatus === 'Present';
  const badgeEl = document.getElementById('modal-status-badge');
  if (isPresent) {
    badgeEl.className = 'badge badge-present';
    badgeEl.innerHTML = '<i class="fas fa-check-circle"></i> Verified Present';
  } else {
    badgeEl.className = 'badge badge-registered';
    badgeEl.innerHTML = '● Registered (Awaiting Entry Check-in)';
  }

  // Render High-Contrast QR Code
  const qrBox = document.getElementById('modal-qr-canvas-box');
  qrBox.innerHTML = '';

  if (pass.qrCodeDataUrl) {
    const img = document.createElement('img');
    img.src = pass.qrCodeDataUrl;
    img.alt = 'Pass QR Code';
    img.style.width = '170px';
    img.style.height = '170px';
    qrBox.appendChild(img);
  } else if (typeof QRCode !== 'undefined') {
    new QRCode(qrBox, {
      text: pass.registrationId,
      width: 170,
      height: 170,
      colorDark: '#5b21b6',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  // Setup download button
  document.getElementById('btn-download-modal-qr').onclick = () => {
    const img = qrBox.querySelector('img');
    if (img && img.src) {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = `EventHub_Pass_${rollNumber}_${pass.eventName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      a.click();
    }
  };

  const modal = document.getElementById('qr-pass-modal');
  modal.style.display = 'flex';
}

function closeQrModal() {
  document.getElementById('qr-pass-modal').style.display = 'none';
}

// Switch between My Passes and My Submissions
function switchStudentTab(tab) {
  const passesView = document.getElementById('view-passes');
  const subsView = document.getElementById('view-submissions');
  const passesBtn = document.getElementById('tab-btn-passes');
  const subsBtn = document.getElementById('tab-btn-submissions');

  if (tab === 'submissions') {
    if (passesView) passesView.style.display = 'none';
    if (subsView) subsView.style.display = 'block';
    if (passesBtn) {
      passesBtn.classList.remove('active');
      passesBtn.style.borderBottom = 'none';
      passesBtn.style.color = '#64748b';
    }
    if (subsBtn) {
      subsBtn.classList.add('active');
      subsBtn.style.borderBottom = '3px solid #6d28d9';
      subsBtn.style.color = '#6d28d9';
    }
  } else {
    if (passesView) passesView.style.display = 'block';
    if (subsView) subsView.style.display = 'none';
    if (subsBtn) {
      subsBtn.classList.remove('active');
      subsBtn.style.borderBottom = 'none';
      subsBtn.style.color = '#64748b';
    }
    if (passesBtn) {
      passesBtn.classList.add('active');
      passesBtn.style.borderBottom = '3px solid #6d28d9';
      passesBtn.style.color = '#6d28d9';
    }
  }

  // Update sidebar active classes
  document.querySelectorAll('.app-sidebar .sidebar-link').forEach(link => {
    const onclickAttr = link.getAttribute('onclick') || '';
    if (tab === 'submissions') {
      if (onclickAttr.includes("'submissions'")) link.classList.add('active');
      else if (onclickAttr.includes('switchStudentTab')) link.classList.remove('active');
    } else {
      if (onclickAttr.includes("'overview'") || onclickAttr.includes("'passes'")) link.classList.add('active');
      else if (onclickAttr.includes('switchStudentTab')) link.classList.remove('active');
    }
  });
}

// Event Creation Modal Handlers (Panel 3)
function openCreateEventModal() {
  const modal = document.getElementById('create-event-modal');
  const alertBox = document.getElementById('create-event-alert');
  if (alertBox) alertBox.style.display = 'none';
  if (modal) modal.style.display = 'flex';
}

function closeCreateEventModal() {
  const modal = document.getElementById('create-event-modal');
  if (modal) modal.style.display = 'none';
}

function setupCreateEventForm() {
  const form = document.getElementById('create-event-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-event');
    const alertBox = document.getElementById('create-event-alert');

    const name = document.getElementById('evt-name').value.trim();
    const category = document.getElementById('evt-category').value;
    const capacity = document.getElementById('evt-capacity').value;
    const date = document.getElementById('evt-date').value;
    const time = document.getElementById('evt-time').value.trim();
    const venue = document.getElementById('evt-venue').value.trim();
    const description = document.getElementById('evt-description').value.trim();

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name, category, capacity, date, time, venue, description })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#ecfdf5';
        alertBox.style.border = '1px solid #a7f3d0';
        alertBox.style.color = '#065f46';
        alertBox.textContent = 'Event proposal submitted successfully! It is pending review by an organizer or admin.';

        form.reset();
        await loadStudentSubmissions();

        setTimeout(() => {
          closeCreateEventModal();
          switchStudentTab('submissions');
        }, 1500);
      } else {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef2f2';
        alertBox.style.border = '1px solid #fecaca';
        alertBox.style.color = '#991b1b';
        alertBox.textContent = data.message || 'Failed to submit event proposal.';
      }
    } catch (err) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fef2f2';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.color = '#991b1b';
      alertBox.textContent = 'Server error during submission.';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right: 4px;"></i> Submit for Approval';
    }
  });
}

// Profile Modal Handlers
function openProfileModal() {
  const user = getCurrentUser();
  if (user) {
    document.getElementById('prof-name').value = user.name || '';
    document.getElementById('prof-rollno').value = user.rollNumber || user.registerNumber || '';
    document.getElementById('prof-email').value = user.email || '';
    document.getElementById('prof-dept').value = user.department || '';
  }
  document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profile-modal').style.display = 'none';
}

function setupFilterButtons() {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderStudentPasses();
    });
  });
}

/**
 * View & Load Certificate Modal
 */
async function viewCertificateModal(registrationId) {
  try {
    const modal = document.getElementById('certificate-modal');
    if (!modal) return;

    if (typeof showToast === 'function') {
      showToast('Loading verified certificate...', 'info');
    }

    const res = await fetch(`/api/certificates/${encodeURIComponent(registrationId)}`, {
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      if (typeof showToast === 'function') {
        showToast(data.message || 'Certificate not available.', 'error');
      }
      return;
    }

    const cert = data.data;

    document.getElementById('cert-modal-student-name').textContent = cert.studentName || 'Student Attendee';
    document.getElementById('cert-modal-roll').textContent = cert.rollNumber || '21BCS042';
    document.getElementById('cert-modal-dept').textContent = cert.department || 'Engineering';
    document.getElementById('cert-modal-event').textContent = cert.eventName || 'Campus Event';
    document.getElementById('cert-modal-organizer').textContent = cert.organizerName || 'KCT Faculty & Coordinators';
    document.getElementById('cert-modal-date').textContent = cert.eventDate || '2026';
    document.getElementById('cert-modal-venue').textContent = cert.eventVenue || 'KCT Campus';
    document.getElementById('cert-modal-id-display').textContent = cert.certificateId || 'KCT-CERT';

    const qrBox = document.getElementById('cert-modal-qr-box');
    if (qrBox) {
      if (cert.verificationQrUrl) {
        qrBox.innerHTML = `<img src="${cert.verificationQrUrl}" alt="Certificate Verification QR" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;">`;
      } else {
        qrBox.innerHTML = `<i class="fas fa-qrcode" style="font-size: 2rem; color: #64748b;"></i>`;
      }
    }

    modal.style.display = 'flex';

  } catch (err) {
    console.error('Error fetching certificate:', err);
    if (typeof showToast === 'function') {
      showToast('Failed to load certificate', 'error');
    }
  }
}

function closeCertificateModal() {
  const modal = document.getElementById('certificate-modal');
  if (modal) modal.style.display = 'none';
}

function printCertificate() {
  window.print();
}

// ==========================================
// FEEDBACK & RATINGS (FEATURE 2)
// ==========================================
async function openFeedbackModal(eventId, eventName, regId) {
  const modal = document.getElementById('feedback-modal');
  if (!modal) return;

  document.getElementById('feedback-event-id').value = eventId;
  document.getElementById('feedback-reg-id').value = regId || '';
  document.getElementById('feedback-modal-event-name').textContent = eventName;
  document.getElementById('feedback-modal-alert').style.display = 'none';
  document.getElementById('feedback-form').reset();
  setFeedbackStarValue(5);

  // Check if student already gave feedback
  try {
    const res = await fetch(`/api/feedback/my/${eventId}`, { headers: getAuthHeaders() });
    const json = await res.json();
    if (json.success && json.submitted && json.feedback) {
      const fb = json.feedback;
      setFeedbackStarValue(fb.overallRating || 5);
      document.getElementById('fb-content-rating').value = String(fb.contentRating || 5);
      document.getElementById('fb-org-rating').value = String(fb.organizationRating || 5);
      document.getElementById('fb-recommend').checked = fb.wouldRecommend !== false;
      document.getElementById('fb-comments').value = fb.comments || '';

      const alertBox = document.getElementById('feedback-modal-alert');
      alertBox.style.display = 'block';
      alertBox.style.background = '#ecfdf5';
      alertBox.style.border = '1px solid #a7f3d0';
      alertBox.style.color = '#065f46';
      alertBox.innerHTML = `<strong>Feedback Recorded!</strong> You previously rated this event ${fb.overallRating} ★ on ${new Date(fb.submittedAt).toLocaleDateString()}.`;
      document.getElementById('btn-submit-feedback').style.display = 'none';
    } else {
      document.getElementById('btn-submit-feedback').style.display = 'inline-flex';
    }
  } catch (e) {}

  modal.style.display = 'flex';
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedback-modal');
  if (modal) modal.style.display = 'none';
}

function setFeedbackStarValue(val) {
  const v = Math.max(1, Math.min(5, Number(val)));
  document.getElementById('fb-overall-val').value = v;
  const stars = document.querySelectorAll('#star-rating-overall i');
  stars.forEach((star, idx) => {
    if (idx < v) {
      star.style.color = '#f59e0b';
    } else {
      star.style.color = '#cbd5e1';
    }
  });
}

function setupFeedbackStarListeners() {
  const stars = document.querySelectorAll('#star-rating-overall i');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      const val = star.getAttribute('data-val');
      setFeedbackStarValue(val);
    });
    star.addEventListener('mouseenter', () => {
      const val = Number(star.getAttribute('data-val'));
      stars.forEach((s, idx) => {
        s.style.color = idx < val ? '#fbbf24' : '#cbd5e1';
      });
    });
  });
  const box = document.getElementById('star-rating-overall');
  if (box) {
    box.addEventListener('mouseleave', () => {
      const current = Number(document.getElementById('fb-overall-val').value || 5);
      setFeedbackStarValue(current);
    });
  }
}

function setupFeedbackForm() {
  const form = document.getElementById('feedback-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = document.getElementById('feedback-event-id').value;
    const overallRating = Number(document.getElementById('fb-overall-val').value || 5);
    const contentRating = Number(document.getElementById('fb-content-rating').value || 5);
    const organizationRating = Number(document.getElementById('fb-org-rating').value || 5);
    const wouldRecommend = document.getElementById('fb-recommend').checked;
    const comments = document.getElementById('fb-comments').value.trim();
    const submitBtn = document.getElementById('btn-submit-feedback');
    const alertBox = document.getElementById('feedback-modal-alert');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          eventId,
          overallRating,
          contentRating,
          organizationRating,
          wouldRecommend,
          comments
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (typeof showToast === 'function') {
          showToast(data.message || 'Feedback submitted successfully!', 'success');
        }
        closeFeedbackModal();
      } else {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef2f2';
        alertBox.style.border = '1px solid #fecaca';
        alertBox.style.color = '#991b1b';
        alertBox.textContent = data.message || 'Failed to submit feedback.';
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
      alertBox.style.display = 'block';
      alertBox.style.background = '#fef2f2';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.color = '#991b1b';
      alertBox.textContent = 'Network error submitting feedback.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right: 4px;"></i> Submit Feedback';
    }
  });
}

document.addEventListener('DOMContentLoaded', initStudentDashboard);
