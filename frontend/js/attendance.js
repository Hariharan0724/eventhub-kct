/**
 * EventHub - Core Attendance Verification & QR Scanner Controller
 * Enforces the exact 5 security response states:
 * 1. Attendance Marked Successfully
 * 2. Attendance Already Marked
 * 3. Registration Not Found
 * 4. You Are Not Authorized for This Event
 * 5. Invalid or Expired QR Pass
 */

let html5QrCodeScanner = null;
let isScannerActive = false;
let currentEventId = '';
let currentEventData = null;
let lastScannedCode = '';
let scanCooldownTimer = null;

// Audio Synthesizer for instant audible feedback
const AudioFeedback = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  },
  play(soundType) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (soundType === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(783.99, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (soundType === 'warning') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(370, now + 0.12);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(160, now + 0.1);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (e) {}
  }
};

// Initialize Attendance Page
async function initAttendancePage() {
  const eventSelect = document.getElementById('attendance-event-select');
  if (!eventSelect) return;

  if (!requireOrganizerAuth()) return;

  const user = getCurrentUser();
  if (user) {
    const scannerUserEl = document.getElementById('sidebar-scanner-user');
    if (scannerUserEl) scannerUserEl.textContent = user.name || 'EventHub Organizer';

    if (user.role === 'admin') {
      const adminLink = document.getElementById('link-admin-panel');
      const adminSection = document.getElementById('admin-section-title');
      if (adminLink) adminLink.style.display = 'flex';
      if (adminSection) adminSection.style.display = 'block';
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const requestedEventId = urlParams.get('eventId');

  try {
    const res = await fetch('/api/events/all', { headers: getAuthHeaders() });
    const data = await res.json();

    if (data.success && data.data && data.data.length > 0) {
      // Filter to approved events for scanning desk
      const approvedEvents = data.data.filter(e => (e.approvalStatus || 'approved') === 'approved');
      const eventsToUse = approvedEvents.length > 0 ? approvedEvents : data.data;

      eventSelect.innerHTML = '';
      eventsToUse.forEach(evt => {
        const opt = document.createElement('option');
        opt.value = evt.id;
        opt.textContent = `${evt.name} (${evt.date})`;
        eventSelect.appendChild(opt);
      });

      currentEventId = requestedEventId || eventsToUse[0].id;
      eventSelect.value = currentEventId;

      await loadSelectedEventDetails(currentEventId);

      eventSelect.addEventListener('change', async (e) => {
        currentEventId = e.target.value;
        clearResultDisplay();
        await loadSelectedEventDetails(currentEventId);
      });
    } else {
      eventSelect.innerHTML = '<option value="">No events available</option>';
    }
  } catch (err) {
    console.error('Error loading events:', err);
    showToast('Failed to load events list', 'error');
  }

  // Setup Manual Attendance Form (Roll Number or Reg ID)
  const manualForm = document.getElementById('manual-attendance-form');
  if (manualForm) {
    manualForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const regIdInput = document.getElementById('manual-reg-id');
      const inputVal = regIdInput.value.trim();
      if (inputVal) {
        verifyAndRecordAttendance(inputVal, 'manual');
        regIdInput.value = '';
      }
    });
  }

  setupScannerControls();
}

async function loadSelectedEventDetails(eventId) {
  try {
    const res = await fetch(`/api/events/${eventId}/attendance`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (data.success) {
      currentEventData = data;
      renderEventStats(data);
      loadRecentCheckIns(eventId);
      loadEventSessions(eventId);
    }
  } catch (err) {
    console.error('Error fetching event attendance data:', err);
  }
}

async function loadEventSessions(eventId) {
  const sessionSelect = document.getElementById('attendance-session-select');
  if (!sessionSelect) return;
  sessionSelect.innerHTML = '<option value="">General Entrance / All Sessions</option>';
  if (!eventId) return;

  try {
    const res = await fetch(`/api/events/${eventId}/sessions`);
    const json = await res.json();
    if (json.success && json.sessions) {
      json.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        opt.textContent = `${s.sessionId}: ${s.name} (${s.time})`;
        sessionSelect.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Error loading sessions:', e);
  }
}

function renderEventStats(data) {
  const { event, attendance } = data;

  const titleEl = document.getElementById('current-event-name');
  const metaEl = document.getElementById('current-event-meta');
  const regCountEl = document.getElementById('stat-registered-count');
  const presCountEl = document.getElementById('stat-present-count');
  const absCountEl = document.getElementById('stat-absent-count');
  const rateEl = document.getElementById('stat-attendance-rate');
  const barEl = document.getElementById('attendance-progress-bar');
  const participantsLink = document.getElementById('view-participants-link');

  if (titleEl) titleEl.textContent = event.name;
  if (metaEl) metaEl.textContent = `📅 ${event.date} • ⏰ ${event.time} • 📍 ${event.venue}`;
  if (regCountEl) regCountEl.textContent = attendance.registered;
  if (presCountEl) presCountEl.textContent = attendance.present;
  if (absCountEl) absCountEl.textContent = attendance.absent;
  if (rateEl) rateEl.textContent = `${attendance.attendancePercentage}%`;
  if (barEl) barEl.style.width = `${attendance.attendancePercentage}%`;
  if (participantsLink) participantsLink.href = `participants.html?eventId=${event.id}`;
}

async function loadRecentCheckIns(eventId) {
  const tbody = document.getElementById('recent-checkins-body');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/events/${eventId}/participants?status=Present&sortBy=checkInTime&order=desc`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (data.success && data.data) {
      if (data.data.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align:center; padding:1.75rem; color:#64748b;">
              No check-ins recorded yet for this session. Start scanning student QR codes or enter Roll Numbers!
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = data.data.slice(0, 10).map((p, idx) => {
        const timeFormatted = p.checkInTime ? new Date(p.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
        const roll = p.rollNumber || p.registerNumber || 'N/A';
        return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 0.75rem 1rem;"><strong>#${idx + 1}</strong></td>
            <td style="padding: 0.75rem 1rem;"><strong style="color: #1e1b4b;">${p.studentName}</strong></td>
            <td style="padding: 0.75rem 1rem;"><span class="user-roll-badge">${roll}</span></td>
            <td style="padding: 0.75rem 1rem; text-align: center;"><span class="badge badge-present"><i class="fas fa-check"></i> Present</span></td>
            <td style="padding: 0.75rem 1rem; font-size: 0.82rem; color: #065f46; font-weight: 500;">${timeFormatted}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error fetching recent check-ins:', err);
  }
}

function setupScannerControls() {
  const startBtn = document.getElementById('btn-start-camera');
  const stopBtn = document.getElementById('btn-stop-camera');
  const fileInput = document.getElementById('qr-file-input');

  if (startBtn) startBtn.addEventListener('click', startQrCamera);
  if (stopBtn) stopBtn.addEventListener('click', stopQrCamera);
  if (fileInput) fileInput.addEventListener('change', handleQrFileUpload);
}

async function startQrCamera() {
  const readerDiv = document.getElementById('reader');
  const startBtn = document.getElementById('btn-start-camera');
  const stopBtn = document.getElementById('btn-stop-camera');

  if (!readerDiv) return;

  if (typeof Html5Qrcode === 'undefined') {
    showToast('QR Scanner engine not loaded. Please refresh page.', 'error');
    return;
  }

  try {
    if (!html5QrCodeScanner) {
      html5QrCodeScanner = new Html5Qrcode('reader');
    }

    const config = {
      fps: 15,
      qrbox: { width: 240, height: 240 },
      aspectRatio: 1.0
    };

    await html5QrCodeScanner.start(
      { facingMode: 'environment' },
      config,
      onQrCodeSuccess,
      onQrCodeError
    );

    isScannerActive = true;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    showToast('Camera active. Point at student QR pass.', 'info');

  } catch (err) {
    console.error('Error starting camera scanner:', err);
    showToast('Camera permission denied or camera not available.', 'error');
  }
}

async function stopQrCamera() {
  const startBtn = document.getElementById('btn-start-camera');
  const stopBtn = document.getElementById('btn-stop-camera');

  if (html5QrCodeScanner && isScannerActive) {
    try {
      await html5QrCodeScanner.stop();
      isScannerActive = false;
      if (startBtn) startBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';
    } catch (err) {
      console.error('Error stopping camera:', err);
    }
  }
}

async function handleQrFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    if (!html5QrCodeScanner) {
      html5QrCodeScanner = new Html5Qrcode('reader');
    }
    const decodedText = await html5QrCodeScanner.scanFile(file, true);
    verifyAndRecordAttendance(decodedText, 'file');
  } catch (err) {
    console.error('Error scanning QR file:', err);
    showToast('Could not read a valid QR code from this image.', 'error');
  } finally {
    e.target.value = '';
  }
}

function onQrCodeSuccess(decodedText) {
  if (decodedText === lastScannedCode && scanCooldownTimer) {
    return;
  }

  lastScannedCode = decodedText;
  clearTimeout(scanCooldownTimer);
  scanCooldownTimer = setTimeout(() => {
    lastScannedCode = '';
  }, 2500);

  verifyAndRecordAttendance(decodedText, 'camera');
}

function onQrCodeError() {}

function clearResultDisplay() {
  const resultDiv = document.getElementById('attendance-result-banner');
  if (resultDiv) {
    resultDiv.style.display = 'none';
    resultDiv.innerHTML = '';
  }
}

/**
 * CORE ATTENDANCE RECORDING & EXACT 5 MESSAGE HANDLER
 */
async function verifyAndRecordAttendance(registrationId, source = 'manual') {
  if (!currentEventId) {
    showToast('Please select an active event first.', 'warning');
    return;
  }

  const resultContainer = document.getElementById('attendance-result-banner');
  if (!resultContainer) return;

  resultContainer.style.display = 'block';
  resultContainer.innerHTML = `
    <div class="scan-feedback-banner" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155;">
      <i class="fas fa-spinner fa-spin" style="font-size: 1.5rem;"></i>
      <div>
        <div style="font-weight: 700;">Verifying ID / Roll Number...</div>
        <div style="font-size: 0.85rem;">Checking registration roster for: <code>${registrationId}</code></div>
      </div>
    </div>
  `;

  const sessionSelect = document.getElementById('attendance-session-select');
  const selectedSession = sessionSelect ? sessionSelect.value : '';
  const endpoint = selectedSession ? '/api/attendance/session-mark' : '/api/attendance/mark';
  const payload = {
    registrationId,
    eventId: currentEventId
  };
  if (selectedSession) payload.sessionId = selectedSession;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    // 1. Attendance Marked Successfully (HTTP 200)
    if (res.status === 200 && data.success) {
      AudioFeedback.play('success');
      const student = data.student || {};
      resultContainer.innerHTML = `
        <div class="scan-feedback-banner feedback-success">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-check"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #065f46;">
              Attendance Marked Successfully
            </div>
            <div style="font-size: 0.88rem; margin-top: 2px;">
              Student: <strong>${student.studentName || 'Student'}</strong> &bull; Roll Number: <span class="user-roll-badge">${student.rollNumber || 'N/A'}</span>
            </div>
            <div style="font-size: 0.8rem; color: #047857; margin-top: 4px;">
              Department: ${student.department || 'Engineering'} &bull; Check-in Time: <strong>${student.checkInTime ? new Date(student.checkInTime).toLocaleTimeString() : 'Just Now'}</strong>
            </div>
          </div>
        </div>
      `;
      await loadSelectedEventDetails(currentEventId);
      showToast('✓ Attendance Marked Successfully', 'success');
      return;
    }

    // 2. Attendance Already Marked (HTTP 409)
    if (res.status === 409) {
      AudioFeedback.play('warning');
      const student = data.student || {};
      const timeStr = data.checkInTime ? new Date(data.checkInTime).toLocaleTimeString() : 'Earlier';
      resultContainer.innerHTML = `
        <div class="scan-feedback-banner feedback-duplicate">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #f59e0b; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-triangle-exclamation"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #92400e;">
              Attendance Already Marked
            </div>
            <div style="font-size: 0.88rem; margin-top: 2px;">
              Student: <strong>${student.studentName || 'Student'}</strong> &bull; Roll Number: <span class="user-roll-badge">${student.rollNumber || 'N/A'}</span>
            </div>
            <div style="font-size: 0.8rem; color: #b45309; margin-top: 4px;">
              Duplicate check-in blocked. Original verified check-in recorded at <strong>${timeStr}</strong>.
            </div>
          </div>
        </div>
      `;
      showToast('⚠ Attendance Already Marked', 'warning');
      return;
    }

    // 3. Registration Not Found (HTTP 404)
    if (res.status === 404) {
      AudioFeedback.play('error');
      resultContainer.innerHTML = `
        <div class="scan-feedback-banner feedback-notfound">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #ef4444; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-user-xmark"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #991b1b;">
              Registration Not Found
            </div>
            <div style="font-size: 0.88rem; margin-top: 2px;">
              No registered participant found matching: <code>${registrationId}</code> for this event.
            </div>
            <div style="font-size: 0.8rem; color: #b91c1c; margin-top: 4px;">
              Please verify that the student completed online registration before gate entry.
            </div>
          </div>
        </div>
      `;
      showToast('✕ Registration Not Found', 'error');
      return;
    }

    // 4. You Are Not Authorized for This Event (HTTP 403)
    if (res.status === 403) {
      AudioFeedback.play('error');
      resultContainer.innerHTML = `
        <div class="scan-feedback-banner feedback-unauthorized">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: #8b5cf6; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-shield-halved"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #581c87;">
              You Are Not Authorized for This Event
            </div>
            <div style="font-size: 0.88rem; margin-top: 2px;">
              ${data.message || 'Only the designated event organizer or system administrator can scan passes for this event.'}
            </div>
          </div>
        </div>
      `;
      showToast('✕ You Are Not Authorized for This Event', 'error');
      return;
    }

    // 5. Invalid or Expired QR Pass (HTTP 400 or Fallback)
    AudioFeedback.play('error');
    resultContainer.innerHTML = `
      <div class="scan-feedback-banner feedback-invalid">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: #f43f5e; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
          <i class="fas fa-barcode"></i>
        </div>
        <div style="flex: 1;">
          <div style="font-size: 1.15rem; font-weight: 800; color: #881337;">
            Invalid or Expired QR Pass
          </div>
          <div style="font-size: 0.88rem; margin-top: 2px;">
            ${data.message || 'The scanned QR code is malformed, unrecognized, or expired.'}
          </div>
        </div>
      </div>
    `;
    showToast('✕ Invalid or Expired QR Pass', 'error');

  } catch (err) {
    console.error('Error verifying attendance:', err);
    resultContainer.innerHTML = `
      <div class="scan-feedback-banner feedback-invalid">
        <div style="font-size: 1rem; font-weight: 700; color: #881337;">
          Network error contacting EventHub server.
        </div>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', initAttendancePage);
