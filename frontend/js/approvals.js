/**
 * EventHub - Event Approvals & Workflow Evaluation Controller (Panel 4)
 * Enforces self-approval blocking and mandatory rejection reasons
 */

let allEvents = [];
let activeTab = 'pending';
let rejectingEventId = null;

async function initApprovals() {
  if (!requireOrganizerAuth()) return;

  const user = getCurrentUser();
  if (user) {
    const evalName = document.getElementById('sidebar-evaluator-name');
    const evalRole = document.getElementById('sidebar-evaluator-role');
    if (evalName) evalName.textContent = user.name || 'EventHub Evaluator';
    if (evalRole) evalRole.textContent = user.role === 'admin' ? 'System Administrator' : 'Faculty Organizer';

    if (user.role === 'admin') {
      const adminLink = document.getElementById('link-admin-panel');
      if (adminLink) adminLink.style.display = 'flex';
    }
  }

  await loadApprovalEvents();
}

async function loadApprovalEvents() {
  const grid = document.getElementById('approvals-grid');

  try {
    const res = await fetch('/api/events/all', {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Failed to load events for approval', 'error');
      return;
    }

    allEvents = data.data || [];

    // Calculate counts
    const pendingList = allEvents.filter(e => (e.approvalStatus || 'pending') === 'pending');
    const approvedList = allEvents.filter(e => e.approvalStatus === 'approved');
    const rejectedList = allEvents.filter(e => e.approvalStatus === 'rejected');

    document.getElementById('count-pending').textContent = pendingList.length;
    document.getElementById('count-approved').textContent = approvedList.length;
    document.getElementById('count-rejected').textContent = rejectedList.length;

    const sidebarBadge = document.getElementById('sidebar-pending-count');
    if (sidebarBadge) {
      sidebarBadge.textContent = pendingList.length;
      sidebarBadge.style.display = pendingList.length > 0 ? 'inline-block' : 'none';
    }

    renderApprovalsGrid();

  } catch (err) {
    console.error('Error loading approval events:', err);
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: white; border-radius: 12px; color: #ef4444;">
          Network error loading approval queue.
        </div>
      `;
    }
  }
}

function switchFilterTab(tab) {
  activeTab = tab;
  ['pending', 'approved', 'rejected'].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if (btn) {
      if (t === tab) {
        btn.classList.add('active');
        btn.style.borderBottom = '3px solid #6d28d9';
        btn.style.color = '#6d28d9';
      } else {
        btn.classList.remove('active');
        btn.style.borderBottom = 'none';
        btn.style.color = '#64748b';
      }
    }
  });

  renderApprovalsGrid();
}

function renderApprovalsGrid() {
  const grid = document.getElementById('approvals-grid');
  if (!grid) return;

  const currentUser = getCurrentUser();
  const currentUserId = currentUser ? currentUser.id : null;

  const filtered = allEvents.filter(e => {
    const status = e.approvalStatus || 'pending';
    return status === activeTab;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; background: white; border-radius: 14px; border: 1px solid #e2e8f0;">
        <i class="fas fa-check-double" style="font-size: 2.5rem; color: #cbd5e1; margin-bottom: 0.75rem;"></i>
        <h3 style="color: #1e1b4b; margin-bottom: 0.35rem;">No Events in ${activeTab.toUpperCase()} Queue</h3>
        <p style="color: #64748b; font-size: 0.88rem;">There are currently no proposals requiring action in this category.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(evt => {
    const isOwner = currentUserId && (evt.createdBy === currentUserId);
    const creatorRole = evt.createdByRole ? evt.createdByRole.toUpperCase() : 'STUDENT';
    const creatorName = evt.createdByName || evt.organizer || 'KCT Campus Member';

    let actionSection = '';

    if (activeTab === 'pending') {
      if (isOwner) {
        actionSection = `
          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.78rem; color: #92400e;">
            <i class="fas fa-shield" style="margin-right: 4px;"></i> <strong>Conflict of Interest Rule:</strong> You created this event submission and cannot approve it yourself. Evaluation must be performed by another authorized organizer or admin.
          </div>
        `;
      } else {
        actionSection = `
          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-outline btn-sm" style="flex: 1; border-color: #ef4444; color: #dc2626;" onclick="openRejectModal('${evt.id}')">
              <i class="fas fa-times" style="margin-right: 4px;"></i> Decline
            </button>
            <button class="btn btn-primary btn-sm" style="flex: 1; background: #16a34a; border-color: #16a34a;" onclick="approveEvent('${evt.id}')">
              <i class="fas fa-check" style="margin-right: 4px;"></i> Approve &amp; Publish
            </button>
          </div>
        `;
      }
    } else if (activeTab === 'approved') {
      const approvedAtFormatted = evt.approvedAt ? new Date(evt.approvedAt).toLocaleDateString() : 'Approved';
      actionSection = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #15803d; background: #f0fdf4; padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid #bbf7d0;">
          <span><i class="fas fa-circle-check"></i> Approved &amp; Published (${approvedAtFormatted})</span>
          <a href="attendance.html?eventId=${evt.id}" class="btn btn-sm btn-outline" style="font-size: 0.75rem; padding: 2px 8px;">Scanner &rarr;</a>
        </div>
      `;
    } else if (activeTab === 'rejected') {
      actionSection = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.82rem; color: #991b1b;">
          <strong><i class="fas fa-ban"></i> Reason:</strong> ${evt.rejectionReason || 'No specific reason provided.'}
        </div>
      `;
    }

    return `
      <div class="event-approval-card">
        <div>
          <!-- Header Tag -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <span class="badge" style="background: #f1f5f9; color: #334155; font-size: 0.75rem;">
              ${evt.category || 'Event'}
            </span>
            <span class="approval-badge ${evt.approvalStatus || 'pending'}">
              ${evt.approvalStatus || 'pending'}
            </span>
          </div>

          <h3 style="font-size: 1.2rem; color: #1e1b4b; margin-bottom: 0.5rem; line-height: 1.25;">
            ${evt.name}
          </h3>

          <!-- Submitter Info Badge -->
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; font-size: 0.82rem; color: #64748b; background: #fafafa; padding: 0.4rem 0.6rem; border-radius: 6px;">
            <i class="fas fa-user-pen"></i>
            <span>Submitted by <strong>${creatorName}</strong> (${creatorRole})</span>
          </div>

          <!-- Event Metadata -->
          <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem; color: #475569; margin-bottom: 1.25rem;">
            <div><i class="fas fa-calendar" style="width: 20px; color: #8b5cf6;"></i> ${evt.date} &bull; ${evt.time || '09:30 AM'}</div>
            <div><i class="fas fa-location-dot" style="width: 20px; color: #8b5cf6;"></i> ${evt.venue}</div>
            <div><i class="fas fa-users" style="width: 20px; color: #8b5cf6;"></i> Maximum Capacity: <strong>${evt.capacity || 100}</strong> participants</div>
          </div>

          ${evt.description ? `
            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 1.25rem; line-height: 1.4;">
              ${evt.description}
            </p>
          ` : ''}
        </div>

        <!-- Action / Status Footer -->
        <div style="border-top: 1px solid #f1f5f9; padding-top: 1rem; margin-top: auto;">
          ${actionSection}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Approve an event submission
 */
async function approveEvent(eventId) {
  const evt = allEvents.find(e => e.id === eventId);
  const eventName = evt ? evt.name : 'this event';
  if (!confirm(`Are you sure you want to approve "${eventName}"? It will be published immediately for student registration.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/events/${eventId}/approve`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Event approved successfully!', 'success');
      await loadApprovalEvents();
    } else {
      showToast(data.message || 'Failed to approve event', 'error');
    }
  } catch (err) {
    console.error('Error approving event:', err);
    showToast('Server error while approving event.', 'error');
  }
}

/**
 * Open Modal to Prompt for Mandatory Rejection Reason
 */
function openRejectModal(eventId) {
  rejectingEventId = eventId;
  const evt = allEvents.find(e => e.id === eventId);
  document.getElementById('reject-event-title').textContent = evt ? evt.name : 'Selected Event';
  document.getElementById('rejection-reason-input').value = '';
  const modal = document.getElementById('reject-modal');
  if (modal) {
    modal.classList.add('show');
    modal.style.display = 'flex';
  }
}

function closeRejectModal() {
  rejectingEventId = null;
  const modal = document.getElementById('reject-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

/**
 * Submit Rejection with Mandatory Reason
 */
async function submitRejection() {
  if (!rejectingEventId) return;

  const reason = document.getElementById('rejection-reason-input').value.trim();
  if (!reason) {
    alert('A justification reason is mandatory when declining an event proposal.');
    return;
  }

  const btn = document.getElementById('btn-confirm-reject');
  btn.disabled = true;
  btn.textContent = 'Declining...';

  try {
    const res = await fetch(`/api/events/${rejectingEventId}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rejectionReason: reason })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Event proposal declined.', 'info');
      closeRejectModal();
      await loadApprovalEvents();
    } else {
      showToast(data.message || 'Failed to decline event', 'error');
    }
  } catch (err) {
    console.error('Error rejecting event:', err);
    showToast('Server error declining event', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Rejection';
  }
}

document.addEventListener('DOMContentLoaded', initApprovals);
