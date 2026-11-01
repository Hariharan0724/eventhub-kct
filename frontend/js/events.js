/**
 * EventHub - Events Catalog & Event Details Controller
 */

let allEvents = [];
let currentCategory = 'all';

// Initialize Events List on events.html
async function loadEventsCatalog() {
  const container = document.getElementById('events-container');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
      <div style="font-size: 1.2rem; color: var(--text-muted);">Loading upcoming KCT events...</div>
    </div>
  `;

  try {
    const res = await fetch('/api/events');
    const data = await res.json();

    if (data.success && data.data) {
      allEvents = data.data;
      renderEventsList();
      setupEventFilters();
    } else {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--danger);">Unable to load events at this moment.</div>`;
    }
  } catch (err) {
    console.error('Error loading events:', err);
    container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--danger);">Failed to connect to the server. Please check your network.</div>`;
  }
}

// Render filtered event cards
function renderEventsList() {
  const container = document.getElementById('events-container');
  if (!container) return;

  const searchInput = document.getElementById('event-search');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = allEvents.filter(evt => {
    const matchCategory = currentCategory === 'all' || (evt.category && evt.category.toLowerCase() === currentCategory.toLowerCase());
    const matchQuery = !query || 
      (evt.name && evt.name.toLowerCase().includes(query)) ||
      (evt.venue && evt.venue.toLowerCase().includes(query)) ||
      (evt.description && evt.description.toLowerCase().includes(query));
    return matchCategory && matchQuery;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem; background: white; border-radius: var(--radius-lg); border: 1px solid var(--border-color);">
        <h3 style="margin-bottom: 0.5rem;">No Events Found</h3>
        <p>No upcoming events match your selected filters. Try changing your search query.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(evt => {
    const isClosed = evt.status === 'closed' || evt.availableSeats <= 0;
    const formattedDate = new Date(evt.date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    const fallbackImg = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80';
    const imgSrc = evt.image || fallbackImg;

    return `
      <div class="event-card">
        <img src="${imgSrc}" alt="${evt.name}" class="event-image" onerror="this.src='${fallbackImg}'">
        <div class="event-content">
          <div class="event-meta">
            <span class="badge badge-category">${evt.category || 'General'}</span>
            <span class="badge ${isClosed ? 'badge-absent' : 'badge-present'}">
              ${isClosed ? 'Closed' : 'Registration Open'}
            </span>
          </div>

          <h3 class="event-title">${evt.name}</h3>
          <p class="event-desc">${evt.description || 'Join this collegiate event hosted at KCT.'}</p>

          <ul class="event-details-list">
            <li>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              <span>${formattedDate} &bull; ${evt.time || 'TBA'}</span>
            </li>
            <li>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              <span>${evt.venue || 'KCT Campus'}</span>
            </li>
          </ul>

          <div class="event-card-footer">
            <div class="seats-badge ${evt.availableSeats < 15 ? 'text-danger' : 'text-muted'}">
              <strong>${evt.availableSeats}</strong> seats left
            </div>
            <a href="event-details.html?id=${evt.id}" class="btn btn-primary btn-sm">
              View Details &rarr;
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Setup search & category button listeners
function setupEventFilters() {
  const searchInput = document.getElementById('event-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderEventsList);
  }

  const filterButtons = document.querySelectorAll('.category-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.getAttribute('data-category');
      renderEventsList();
    });
  });
}

// Load Single Event Details on event-details.html
async function loadEventDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');

  const wrapper = document.getElementById('event-details-wrapper');
  if (!wrapper) return;

  if (!eventId) {
    wrapper.innerHTML = `
      <div style="text-align: center; padding: 4rem;">
        <h2>Event Not Specified</h2>
        <p>Please return to the events catalog and select an event.</p>
        <a href="events.html" class="btn btn-primary" style="margin-top: 1rem;">Browse Events</a>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/events/${eventId}`);
    const result = await res.json();

    if (!result.success || !result.data) {
      wrapper.innerHTML = `
        <div style="text-align: center; padding: 4rem;">
          <h2>Event Not Found</h2>
          <p>The event you requested could not be located in our system.</p>
          <a href="events.html" class="btn btn-primary" style="margin-top: 1rem;">Back to Events</a>
        </div>
      `;
      return;
    }

    const evt = result.data;
    const isClosed = evt.status === 'closed' || evt.remainingSeats <= 0;
    const formattedDate = new Date(evt.date).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const fallbackImg = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80';
    const imgSrc = evt.image || fallbackImg;

    wrapper.innerHTML = `
      <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 2rem;">
        <div style="height: 340px; position: relative;">
          <img src="${imgSrc}" alt="${evt.name}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='${fallbackImg}'">
          <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(15, 23, 42, 0.85)); padding: 2rem; color: white;">
            <span class="badge badge-category" style="background: white; color: var(--primary-dark); margin-bottom: 0.5rem;">${evt.category || 'Technical'}</span>
            <h1 style="color: white; font-size: 2.2rem; margin-bottom: 0.25rem;">${evt.name}</h1>
            <p style="color: #cbd5e1; font-size: 0.95rem;">Organized by: ${evt.organizer || 'Kumaraguru College of Technology'}</p>
          </div>
        </div>

        <div style="padding: 2rem;">
          <div class="grid-3" style="margin-bottom: 2.5rem;">
            <div class="card" style="background: var(--bg-muted);">
              <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.25rem;">Date & Time</div>
              <div style="font-size: 1.05rem; font-weight: 700; color: var(--secondary);">${formattedDate}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">${evt.time || 'Full Day'}</div>
            </div>

            <div class="card" style="background: var(--bg-muted);">
              <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.25rem;">Venue</div>
              <div style="font-size: 1.05rem; font-weight: 700; color: var(--secondary);">${evt.venue || 'KCT Campus'}</div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Coimbatore, Tamil Nadu</div>
            </div>

            <div class="card" style="background: var(--bg-muted);">
              <div style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 0.25rem;">Seats Availability</div>
              <div style="font-size: 1.05rem; font-weight: 700; color: ${evt.remainingSeats < 10 ? 'var(--danger)' : 'var(--success)'};">
                ${evt.remainingSeats} / ${evt.capacity} Available
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">${evt.registeredCount} Students Registered</div>
            </div>
          </div>

          <div style="margin-bottom: 2.5rem;">
            <h2 style="font-size: 1.4rem; margin-bottom: 0.75rem;">About the Event</h2>
            <p style="font-size: 1.05rem; line-height: 1.7; color: var(--text-main); white-space: pre-line;">${evt.description || 'Join this engaging student event.'}</p>
          </div>

          <div style="margin-bottom: 2.5rem; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius-lg); padding: 1.5rem;">
            <h3 style="font-size: 1.15rem; color: #92400e; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>
              Event Rules & Attendance Requirements
            </h3>
            <div style="font-size: 0.95rem; color: #78350f; line-height: 1.6; white-space: pre-line;">${evt.rules || '1. Valid College ID Card required at venue.\n2. Present your EventHub Digital QR Code at the registration desk.'}</div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 1.5rem; flex-wrap: wrap; gap: 1rem;">
            <div>
              <span class="badge ${isClosed ? 'badge-absent' : 'badge-present'}" style="font-size: 0.9rem; padding: 0.4rem 1rem;">
                ${isClosed ? 'Registration Closed' : 'Registration Active'}
              </span>
            </div>

            <div style="display: flex; gap: 1rem;">
              <a href="events.html" class="btn btn-outline">&larr; Back to Catalog</a>
              ${isClosed 
                ? `<button class="btn btn-secondary" disabled>Registration Closed</button>`
                : `<a href="register.html?eventId=${evt.id}" class="btn btn-primary btn-lg">Register Now &rarr;</a>`
              }
            </div>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    console.error('Error fetching event details:', err);
    wrapper.innerHTML = `<div style="text-align: center; padding: 4rem; color: var(--danger);">Unable to load event details.</div>`;
  }
}

// Load Spotlight Events on Landing Page (index.html)
async function loadSpotlightEvents() {
  const spotlightContainer = document.getElementById('spotlight-events');
  if (!spotlightContainer) return;

  try {
    const res = await fetch('/api/events');
    const data = await res.json();

    if (data.success && data.data && data.data.length > 0) {
      const top3 = data.data.slice(0, 3);
      spotlightContainer.innerHTML = top3.map(evt => {
        const formattedDate = new Date(evt.date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short'
        });
        const fallbackImg = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=600&q=80';
        return `
          <div class="event-card">
            <img src="${evt.image || fallbackImg}" alt="${evt.name}" class="event-image" onerror="this.src='${fallbackImg}'">
            <div class="event-content">
              <div class="event-meta">
                <span class="badge badge-category">${evt.category || 'Technical'}</span>
                <span class="badge badge-present">Open</span>
              </div>
              <h3 class="event-title" style="font-size: 1.15rem;">${evt.name}</h3>
              <p class="event-desc">${evt.description || 'KCT Campus Event'}</p>
              <div class="event-card-footer">
                <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted);">
                  📅 ${formattedDate}
                </span>
                <a href="event-details.html?id=${evt.id}" class="btn btn-primary btn-sm">Register &rarr;</a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.warn('Could not load spotlight events:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadEventsCatalog();
  loadEventDetails();
  loadSpotlightEvents();
});
