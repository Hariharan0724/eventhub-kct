/**
 * EventHub - Student Registration & Ticket Pass Controller
 * Handles student account creation, event registration booking,
 * and authenticated pass lookup / rendering.
 */

// Initialize Registration Page (register.html)
async function initRegistrationPage() {
  const eventForm = document.getElementById('student-reg-form');
  const signupForm = document.getElementById('student-signup-form');
  const eventSelect = document.getElementById('reg-event-select');
  if (!eventForm && !signupForm) return;

  const urlParams = new URLSearchParams(window.location.search);
  const preselectedEventId = urlParams.get('eventId');
  const mode = urlParams.get('mode');

  // Setup Tabs
  setupRegistrationTabs(mode);

  // Pre-fill student info if logged in
  prefillStudentInfo();

  // Populate events list
  if (eventSelect) {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();

      if (data.success && data.data) {
        eventSelect.innerHTML = '<option value="">-- Choose an Event --</option>';
        data.data.forEach(evt => {
          const isClosed = evt.status === 'closed' || evt.availableSeats <= 0;
          const opt = document.createElement('option');
          opt.value = evt.id;
          opt.textContent = `${evt.name} (${evt.date} - ${evt.availableSeats} seats left)`;
          if (isClosed) {
            opt.disabled = true;
            opt.textContent += ' [CLOSED]';
          }
          if (evt.id === preselectedEventId) {
            opt.selected = true;
          }
          eventSelect.appendChild(opt);
        });

        // Update event info snippet
        updateEventSnippet(data.data, eventSelect.value);
        eventSelect.addEventListener('change', () => {
          updateEventSnippet(data.data, eventSelect.value);
        });
      }
    } catch (err) {
      console.error('Error populating events dropdown:', err);
    }
  }

  // Handle Event Registration Submission
  if (eventForm) {
    eventForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = document.getElementById('btn-submit-event-reg');
      const alertBox = document.getElementById('form-alert');
      if (alertBox) alertBox.style.display = 'none';

      // Verify student is logged in
      if (!isLoggedIn()) {
        showFormAlert(`
          <strong>Authentication Required:</strong> Please <a href="login.html?role=student" style="color:var(--primary); font-weight:700;">log in</a> or <a href="#" id="alert-signup-link" style="color:var(--primary); font-weight:700;">create an account</a> before reserving an event pass.
        `, 'warning');
        const signupLink = document.getElementById('alert-signup-link');
        if (signupLink) {
          signupLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            switchTab('account');
          });
        }
        return;
      }

      const payload = {
        eventId: eventSelect ? eventSelect.value : '',
        studentName: document.getElementById('student-name').value.trim(),
        email: document.getElementById('student-email').value.trim(),
        rollNumber: document.getElementById('register-number').value.trim().toUpperCase(),
        registerNumber: document.getElementById('register-number').value.trim().toUpperCase(),
        department: document.getElementById('department').value,
        year: document.getElementById('year').value,
        phone: document.getElementById('phone-number').value.trim()
      };

      if (!payload.eventId) {
        showFormAlert('Please select an event to register for.', 'danger');
        return;
      }
      if (!payload.studentName || !payload.email || !payload.rollNumber || !payload.department || !payload.year || !payload.phone) {
        showFormAlert('All fields are required. Please fill in all details.', 'danger');
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Processing Registration...';
        }

        const res = await fetch('/api/registrations', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });

        const result = await res.json();

        if (res.status === 201 && result.success) {
          showToast('Registration confirmed!', 'success');
          window.location.href = `registration-success.html?id=${result.data.registrationId}`;
        } else if (res.status === 401) {
          showFormAlert('Your session has expired. Please <a href="login.html?role=student">log in again</a>.', 'danger');
        } else if (res.status === 409) {
          showFormAlert(`
            <strong>⚠ Duplicate Registration:</strong><br>
            ${result.message}<br>
            ${result.existingRegistrationId ? `<a href="registration-success.html?id=${result.existingRegistrationId}" class="btn btn-sm btn-outline" style="margin-top:0.5rem; background:white;">View Existing QR Pass &rarr;</a>` : ''}
          `, 'warning');
        } else {
          showFormAlert(result.message || 'Registration failed. Please try again.', 'danger');
        }
      } catch (err) {
        console.error('Registration submit error:', err);
        showFormAlert('Unable to connect to the server. Please check your network connection.', 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Complete Registration &amp; Get QR Pass &rarr;';
        }
      }
    });
  }

  // Handle Student Account Sign Up Submission
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = document.getElementById('btn-submit-signup');
      const rollVal = document.getElementById('signup-regno').value.trim().toUpperCase();
      const passVal = document.getElementById('signup-password').value;
      const payload = {
        name: document.getElementById('signup-name').value.trim(),
        email: document.getElementById('signup-email').value.trim().toLowerCase(),
        password: passVal,
        confirmPassword: passVal,
        rollNumber: rollVal,
        registerNumber: rollVal,
        phone: document.getElementById('signup-phone').value.trim(),
        department: document.getElementById('signup-dept').value,
        year: document.getElementById('signup-year').value
      };

      if (!payload.name || !payload.email || !payload.password || !payload.rollNumber || !payload.phone || !payload.department || !payload.year) {
        showFormAlert('All fields are required for student registration.', 'danger');
        return;
      }

      if (payload.password.length < 6) {
        showFormAlert('Password must be at least 6 characters long.', 'danger');
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating Account...';
        }

        const result = await registerStudent(payload);

        if (result.success) {
          showToast('Account created successfully! Welcome to EventHub.', 'success');
          // Pre-fill event form and switch back
          prefillStudentInfo();
          setupNavbar();

          if (eventSelect && eventSelect.value) {
            switchTab('event');
            showToast('Ready! Confirm your event booking below.', 'info');
          } else {
            // Redirect to student dashboard
            setTimeout(() => {
              window.location.href = 'student-dashboard.html';
            }, 1000);
          }
        } else {
          showFormAlert(result.message || 'Account registration failed.', 'danger');
        }
      } catch (err) {
        console.error('Signup error:', err);
        showFormAlert('Server communication error during registration.', 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Student Account & Proceed →';
        }
      }
    });
  }
}

/**
 * Setup navigation between Event Booking and Account Sign Up tabs
 */
function setupRegistrationTabs(initialMode) {
  const tabEvent = document.getElementById('tab-btn-event-reg');
  const tabAccount = document.getElementById('tab-btn-account-reg');
  const switchBtn = document.getElementById('btn-switch-to-signup');

  if (tabEvent && tabAccount) {
    tabEvent.addEventListener('click', () => switchTab('event'));
    tabAccount.addEventListener('click', () => switchTab('account'));
  }

  if (switchBtn) {
    switchBtn.addEventListener('click', () => switchTab('account'));
  }

  if (initialMode === 'signup') {
    switchTab('account');
  }
}

function switchTab(tab) {
  const cardEvent = document.getElementById('card-event-reg');
  const cardAccount = document.getElementById('card-account-reg');
  const tabEvent = document.getElementById('tab-btn-event-reg');
  const tabAccount = document.getElementById('tab-btn-account-reg');
  const pageTitle = document.getElementById('reg-page-title');
  const pageSubtitle = document.getElementById('reg-page-subtitle');
  const alertBox = document.getElementById('form-alert');

  if (alertBox) alertBox.style.display = 'none';

  if (tab === 'account') {
    if (cardEvent) cardEvent.style.display = 'none';
    if (cardAccount) cardAccount.style.display = 'block';
    if (tabEvent) {
      tabEvent.classList.remove('active');
      tabEvent.classList.add('btn-outline');
    }
    if (tabAccount) {
      tabAccount.classList.add('active');
      tabAccount.classList.remove('btn-outline');
    }
    if (pageTitle) pageTitle.textContent = 'Create Student Account';
    if (pageSubtitle) pageSubtitle.textContent = 'Register once with your official KCT credentials to attend events seamlessly.';
  } else {
    if (cardEvent) cardEvent.style.display = 'block';
    if (cardAccount) cardAccount.style.display = 'none';
    if (tabEvent) {
      tabEvent.classList.add('active');
      tabEvent.classList.remove('btn-outline');
    }
    if (tabAccount) {
      tabAccount.classList.remove('active');
      tabAccount.classList.add('btn-outline');
    }
    if (pageTitle) pageTitle.textContent = 'Event Registration';
    if (pageSubtitle) pageSubtitle.textContent = 'Reserve your seat for upcoming campus events and instantly generate your digital QR entry pass.';
  }
}

/**
 * Pre-populate student details from authenticated session
 */
function prefillStudentInfo() {
  const banner = document.getElementById('auth-reminder-banner');
  const user = getCurrentUser();

  if (isLoggedIn() && user && user.role === 'student') {
    if (banner) banner.style.display = 'none';

    const nameEl = document.getElementById('student-name');
    const emailEl = document.getElementById('student-email');
    const regnoEl = document.getElementById('register-number');
    const phoneEl = document.getElementById('phone-number');
    const deptEl = document.getElementById('department');
    const yearEl = document.getElementById('year');

    if (nameEl && user.name) nameEl.value = user.name;
    if (emailEl && user.email) emailEl.value = user.email;
    if (regnoEl) regnoEl.value = user.rollNumber || user.registerNumber || '';
    if (phoneEl && user.phone) phoneEl.value = user.phone;
    if (deptEl && user.department) deptEl.value = user.department;
    if (yearEl && user.year) yearEl.value = user.year;
  } else {
    if (banner) banner.style.display = 'block';
  }
}

function updateEventSnippet(events, selectedId) {
  const snippet = document.getElementById('selected-event-info');
  if (!snippet) return;

  const found = events.find(e => e.id === selectedId);
  if (!found) {
    snippet.style.display = 'none';
    return;
  }

  snippet.style.display = 'block';
  snippet.innerHTML = `
    <div style="background: var(--primary-light); border: 1px solid #bfdbfe; border-radius: var(--radius-md); padding: 1rem; margin-top: 0.5rem;">
      <div style="font-weight: 700; color: var(--primary-dark); font-size: 1rem;">${found.name}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
        📍 ${found.venue} &bull; 📅 ${found.date} (${found.time || 'Full day'})
      </div>
      <div style="font-size: 0.85rem; margin-top: 0.25rem; font-weight: 600; color: ${found.availableSeats < 10 ? 'var(--danger)' : 'var(--success)'};">
        ⚡ ${found.availableSeats} of ${found.capacity} seats remaining
      </div>
    </div>
  `;
}

function showFormAlert(html, type = 'danger') {
  const alertBox = document.getElementById('form-alert');
  if (!alertBox) return;

  alertBox.className = `result-card result-case-${type === 'warning' ? '2' : '3'}`;
  alertBox.style.display = 'block';
  alertBox.style.marginTop = '1rem';
  alertBox.style.marginBottom = '1.5rem';
  alertBox.innerHTML = html;
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Initialize Registration Success Page (registration-success.html)
async function initRegistrationSuccess() {
  const container = document.getElementById('success-ticket-container');
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const regId = urlParams.get('id');

  if (!regId) {
    container.innerHTML = `
      <div style="text-align: center; padding: 4rem;">
        <h2>No Registration Specified</h2>
        <p>Please enter your Registration ID or browse events.</p>
        <a href="student-dashboard.html" class="btn btn-primary" style="margin-top: 1rem;">My Student Dashboard</a>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/registrations/${regId}`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();

    if (res.status === 401) {
      container.innerHTML = `
        <div style="text-align: center; padding: 4rem;">
          <h2 style="color: var(--danger);">Authentication Required</h2>
          <p>Please log in to view your registration ticket pass.</p>
          <a href="login.html?role=student" class="btn btn-primary" style="margin-top: 1rem;">Log In as Student</a>
        </div>
      `;
      return;
    }

    if (res.status === 403) {
      container.innerHTML = `
        <div style="text-align: center; padding: 4rem;">
          <h2 style="color: var(--danger);">Access Denied (HTTP 403)</h2>
          <p>You are not authorized to view another student's registration pass.</p>
          <a href="student-dashboard.html" class="btn btn-primary" style="margin-top: 1rem;">Back to My Dashboard</a>
        </div>
      `;
      return;
    }

    if (!result.success || !result.data) {
      container.innerHTML = `
        <div style="text-align: center; padding: 4rem;">
          <h2 style="color: var(--danger);">Registration Not Found</h2>
          <p>No valid registration pass was found for ID: <code>${regId}</code>.</p>
          <a href="events.html" class="btn btn-primary" style="margin-top: 1rem;">Back to Events</a>
        </div>
      `;
      return;
    }

    const reg = result.data;
    const isPresent = reg.attendanceStatus === 'Present';
    const formattedDate = reg.eventDate ? new Date(reg.eventDate).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) : 'Date TBA';

    container.innerHTML = `
      <div class="ticket-card">
        <div class="ticket-header">
          <div class="ticket-institution">Kumaraguru College of Technology &bull; Coimbatore</div>
          <div class="ticket-event-name">${reg.eventName || 'College Event'}</div>
          <div style="font-size: 0.9rem; opacity: 0.9; margin-top: 0.25rem;">
            📅 ${formattedDate} &bull; 📍 ${reg.eventVenue || 'KCT Campus'}
          </div>
        </div>

        <div class="ticket-divider">
          <div class="ticket-cutout-left"></div>
          <div class="ticket-dashed-line"></div>
          <div class="ticket-cutout-right"></div>
        </div>

        <div class="ticket-body">
          <div style="margin-bottom: 1.25rem;">
            <div style="color: var(--success); font-weight: 800; font-size: 1.3rem; margin-bottom: 0.25rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
              <svg width="24" height="24" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Registration Confirmed ✓
            </div>
            <p style="font-size: 0.9rem; color: var(--text-muted);">
              Your seat has been reserved. Please display this QR code at the venue entry.
            </p>
          </div>

          <!-- Registration ID Display -->
          <div>
            <span class="reg-id-display">${reg.registrationId}</span>
          </div>

          <!-- QR Code Canvas Container -->
          <div class="qr-box" id="qr-container">
            <!-- Rendered below via JS / Image -->
          </div>

          <div style="margin-bottom: 1.5rem;">
            <span class="badge ${isPresent ? 'badge-present' : 'badge-registered'}" style="font-size: 0.85rem; padding: 0.4rem 1rem;">
              Status: ${isPresent ? '✓ Present (Checked-in)' : '● Registered (Awaiting Check-in)'}
            </span>
          </div>

          <!-- Student Meta Grid -->
          <div class="student-info-grid" style="text-align: left; margin-bottom: 1.5rem;">
            <div class="student-info-item">
              <span class="label">Student Name</span>
              <span class="value">${reg.studentName}</span>
            </div>
            <div class="student-info-item">
              <span class="label">Register Number</span>
              <span class="value">${reg.registerNumber}</span>
            </div>
            <div class="student-info-item">
              <span class="label">Department</span>
              <span class="value">${reg.department}</span>
            </div>
            <div class="student-info-item">
              <span class="label">Year / Email</span>
              <span class="value">${reg.year} &bull; ${reg.email}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            <button onclick="downloadQrCode('${reg.registrationId}')" class="btn btn-outline btn-sm">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Download QR
            </button>
            <button onclick="window.print()" class="btn btn-primary btn-sm">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              Print Pass
            </button>
            <a href="student-dashboard.html" class="btn btn-outline btn-sm">
              My Passes
            </a>
          </div>
        </div>
      </div>
    `;

    // Render QR Code inside #qr-container
    const qrTarget = document.getElementById('qr-container');
    if (reg.qrCodeDataUrl) {
      qrTarget.innerHTML = `<img id="qr-image" src="${reg.qrCodeDataUrl}" alt="QR Pass" style="width: 190px; height: 190px;">`;
    } else if (typeof QRCode !== 'undefined') {
      new QRCode(qrTarget, {
        text: reg.registrationId,
        width: 190,
        height: 190,
        colorDark: '#1e3a8a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

  } catch (err) {
    console.error('Error fetching ticket details:', err);
    container.innerHTML = `<div style="text-align: center; padding: 4rem; color: var(--danger);">Failed to load registration ticket.</div>`;
  }
}

// Download QR code helper
function downloadQrCode(regId) {
  const img = document.getElementById('qr-image') || document.querySelector('#qr-container img') || document.querySelector('#qr-container canvas');
  if (!img) return;

  const a = document.createElement('a');
  a.download = `EventHub_QR_${regId}.png`;
  a.href = img.tagName === 'CANVAS' ? img.toDataURL('image/png') : img.src;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Initialize Student Lookup Page (my-registration.html)
async function initMyRegistrationPage() {
  const form = document.getElementById('search-reg-form');
  const resultsContainer = document.getElementById('lookup-results');
  if (!form || !resultsContainer) return;

  // If user is logged in as a student, redirect to student-dashboard.html for richer experience
  if (isLoggedIn() && isStudent()) {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.get('no_redirect')) {
      window.location.href = 'student-dashboard.html';
      return;
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const initialQuery = urlParams.get('query') || urlParams.get('id');

  if (initialQuery) {
    document.getElementById('lookup-query').value = initialQuery;
    executeLookup(initialQuery);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = document.getElementById('lookup-query').value.trim();
    if (query) {
      executeLookup(query);
    }
  });

  async function executeLookup(query) {
    if (!isLoggedIn()) {
      resultsContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem; background: white;">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔒</div>
          <h3 style="margin-bottom: 0.5rem;">Student Login Required</h3>
          <p>Please log in with your student credentials to verify and retrieve your registrations.</p>
          <a href="login.html?role=student" class="btn btn-primary" style="margin-top: 1rem;">Log In as Student &rarr;</a>
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = `
      <div style="text-align: center; padding: 2.5rem;">
        <p style="color: var(--text-muted);">Searching KCT registrations for "${query}"...</p>
      </div>
    `;

    try {
      const res = await fetch(`/api/registrations/search?query=${encodeURIComponent(query)}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();

      if (!data.success || !data.data || data.data.length === 0) {
        resultsContainer.innerHTML = `
          <div class="card" style="text-align: center; padding: 3rem; background: white;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
            <h3 style="margin-bottom: 0.5rem;">No Registrations Found</h3>
            <p>We could not find any active event registration matching "${query}" in your authorized account.</p>
            <p style="font-size: 0.85rem; margin-top: 0.5rem;">Double check your Register Number or Registration ID.</p>
          </div>
        `;
        return;
      }

      resultsContainer.innerHTML = `
        <div style="margin-bottom: 1.5rem; font-weight: 600; color: var(--secondary);">
          Found ${data.data.length} registered event(s):
        </div>
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          ${data.data.map(reg => {
            const isPresent = reg.attendanceStatus === 'Present';
            const checkInFormatted = reg.checkInTime ? new Date(reg.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return `
              <div class="card" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem;">
                <div style="flex: 1; min-width: 250px;">
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
                    <span class="badge ${isPresent ? 'badge-present' : 'badge-registered'}">
                      ${isPresent ? `✓ Present (${checkInFormatted})` : '● Registered (Pending Check-in)'}
                    </span>
                    <span style="font-family: monospace; font-weight: 700; color: var(--primary-dark); font-size: 0.85rem;">
                      ${reg.registrationId}
                    </span>
                  </div>
                  <h3 style="font-size: 1.25rem; margin-bottom: 0.25rem;">${reg.eventName}</h3>
                  <div style="font-size: 0.85rem; color: var(--text-muted);">
                    Student: <strong>${reg.studentName}</strong> (${reg.registerNumber}) &bull; ${reg.department}
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
                    📍 ${reg.eventVenue} &bull; 📅 ${reg.eventDate}
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 1rem;">
                  <a href="registration-success.html?id=${reg.registrationId}" class="btn btn-primary btn-sm">
                    View QR Pass &rarr;
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      console.error('Lookup error:', err);
      resultsContainer.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--danger);">Search failed. Please try again.</div>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initRegistrationPage();
  initRegistrationSuccess();
  initMyRegistrationPage();
});
