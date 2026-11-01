# EventHub – Digital Event Attendance Management System
**Kumaraguru College of Technology (KCT), Coimbatore**  
**Course:** Cloud Application Development (CAD) | 30-Hour Project Component  

> *"Register. Attend. Track. Verify."* — An enterprise-grade, cloud-native event attendance, certification, and academic compliance management system for Kumaraguru College of Technology.

---

## 1. Problem Statement & Institutional Context

During college symposiums, hackathons, guest lectures, and technical workshops at **Kumaraguru College of Technology (KCT)**, academic event organizers and student affairs departments face systemic operational bottlenecks with manual attendance tracking:

* **Long Entrance Queues:** Finding student names on multi-page printed sheets causes congestion at venue entrances.
* **Proxy and Unregistered Walk-ins:** Lack of instant identity verification allows unapproved walk-ins or students from other departments to enter without registration.
* **Duplicate or Missing Sign-ins:** Hand-written signatures are frequently illegible, missed, or accidentally recorded multiple times.
* **Manual "On-Duty" (OD) Processing:** Anna University / KCT academic regulations mandate proof of verified attendance before granting student attendance excuses, requiring laborious paper slips and physical signatures.
* **Post-Event Friction:** Manually compiling spreadsheets for certificate issuance, participant feedback collection, and HOD sign-offs takes days of manual effort.

---

## 2. Solution Architecture & Key Capabilities

**EventHub** replaces manual paper workflows with a high-speed digital QR code lifecycle, strict 5-case verification, Server-Sent Events (SSE) live gate feeds, tamper-evident digital certificates, academic On-Duty (OD) slips, and multi-session hackathon tracking:

$$\text{Proposal} \rightarrow \text{Approval} \rightarrow \text{Registration} \rightarrow \text{QR Pass} \rightarrow \text{Live Scan} \rightarrow \text{Certificate + OD Slip} \rightarrow \text{Feedback Analytics}$$

### Core Features

1. **Academic On-Duty (OD) Requisition Generator:**
   - Formal collegiate letterhead with KCT crest, watermark, and Anna University 8-period excuse breakdown.
   - Tamper-proof verification code (`KCT-OD-2026-XXXX`) with embedded QR code.
   - 3-tier clearance blocks: *Faculty Coordinator*, *Organizing HOD*, and *Student Department Class Advisor*.
   - Public clearance verification endpoint for academic advisors.

2. **Tamper-Evident Participation Certificates:**
   - High-resolution collegiate certificates generated automatically upon verified check-in.
   - Embedded verification QR code linking to public verification portal (`/verify-certificate.html?certId=...`).
   - Immutable audit logging on certificate generation.

3. **Post-Event Student Feedback & Satisfaction Analytics:**
   - 5-star rating matrix: *Overall Experience*, *Content Quality*, *Organization & Logistics*.
   - Net Recommendation % and verbatim student feedback reviews.
   - Campus-wide institutional quality benchmark dashboard.

4. **Multi-Session / Multi-Day Hackathon Tracking:**
   - Configurable session tracks (e.g., *Forenoon Keynote*, *Afternoon Hack Track*, *Day 2 Final Pitch*).
   - Session-specific QR check-in with duplicate scan rejection.
   - Attendance matrix table with dynamic threshold clearance.

5. **Security & Role-Based Access Control (RBAC):**
   - 3 cryptographically secured roles: **Student**, **Organizer**, **Admin**.
   - Passwords hashed using `bcryptjs` (salt rounds: 10); sessions managed via signed 24h JWTs.
   - Complete data isolation and ownership boundaries across students and organizers.

6. **Admin Master Operations & Audit Trail:**
   - System KPIs and department attendance distribution charts.
   - Student roster management (activate/deactivate, roll number edits with duplicate prevention).
   - Attendance corrections with mandatory justification audit logging.
   - Immutable audit log viewer with timestamp, operator, and action details.
   - Automated email dispatch simulation and delivery logs.

7. **Real-Time Live Gate Monitoring:**
   - Server-Sent Events (SSE) feed (`/api/attendance/live-stream`) broadcasting real-time venue check-ins.
   - Official Academic Attendance Roster with Dean/HOD sign-off seals.
   - CSV attendance spreadsheet export with verified college roll numbers.

---

## 3. Technology Stack & Deployment

* **Backend:** Node.js (v24+), Express.js REST API, Server-Sent Events (SSE), Morgan logging, CORS.
* **Security & Tokens:** `jsonwebtoken` (JWT), `bcryptjs` password hashing.
* **Database & Persistence:**
  - **Firebase Firestore Cloud SDK:** Full integration via `firebase-admin`.
  - **Local Persistent Firestore Document Store:** Out-of-the-box local JSON store (`backend/data/firestore_db.json`) enabling zero-setup offline evaluation.
* **QR Engine:** `qrcode` (backend SVG/PNG rendering), `html5-qrcode` & `qrcodejs` (frontend camera scanner).
* **Frontend:** Responsive HTML5/CSS3 (Modern KCT Design System, print media queries for OD slips & certificates), Vanilla JavaScript (ES6+).
* **Containerization & Orchestration:**
  - `Dockerfile` (optimized multi-stage build).
  - Kubernetes manifests (`k8s/namespace.yaml`, `configmap.yaml`, `deployment.yaml`, `service.yaml`, `hpa.yaml`, `ingress.yaml`).

---

## 4. Project Directory Structure

```text
cad-project/
├── backend/
│   ├── server.js                    # Express app entry point & route mounting
│   ├── firebase.js                  # Firestore persistence adapter (Cloud & Local)
│   ├── seed.js                      # Realistic KCT seed data (Users, Events, Passes)
│   ├── audit.js                     # Immutable system audit trail service
│   ├── email.js                     # Automated email dispatch & logging service
│   ├── test_suite.js                # 13-group automated test runner (123 test cases)
│   ├── middleware/
│   │   └── auth.js                  # JWT verification & RBAC role guards
│   ├── data/
│   │   ├── firestore_db.json        # Persistent document store
│   │   └── sent_emails.json         # Simulated outbound email store
│   └── routes/
│       ├── auth.js                  # Authentication, profile & account management
│       ├── events.js                # Events CRUD, approvals, sessions, roster & CSV
│       ├── registrations.js         # Student registrations & pass queries
│       ├── attendance.js            # QR scanning (5 cases), session-mark & SSE stream
│       ├── admin.js                 # Roll number update, attendance correction & audit logs
│       ├── dashboard.js             # Campus analytics & student personal metrics
│       ├── certificates.js          # Certificate generation & public QR verification
│       ├── od.js                    # Academic On-Duty slips & public verification
│       └── feedback.js              # Student ratings, reviews & campus benchmarks
│
├── frontend/
│   ├── index.html                   # Public Portal Landing Page & Event Catalog
│   ├── events.html                  # Upcoming Events with category filters & search
│   ├── event-details.html           # Event schedule, capacity & rules
│   ├── register.html                # Student Event Booking & account sign-up
│   ├── registration-success.html    # Pass confirmation screen with printable QR badge
│   ├── student-dashboard.html       # Student Portal (Passes, Certificates, OD Slips, Feedback)
│   ├── organizer-dashboard.html     # Organizer Operations Center (Analytics, Matrix, Feedback)
│   ├── admin-dashboard.html         # Master Admin Center (Students, Audit Logs, Corrections)
│   ├── attendance.html              # Live QR Scanner Terminal (Single & Multi-Session)
│   ├── academic-od.html             # Printable Anna University / KCT OD Requisition Slip
│   ├── academic-roster.html         # Official Attendance Roster with HOD sign-off seals
│   ├── verify-certificate.html      # Public Certificate Verification Portal
│   ├── participants.html            # Participant roster & CSV download
│   ├── login.html                   # Unified Multi-Role Login Portal with Auto-Fill
│   ├── css/
│   │   └── style.css                # Institutional Design System & print styles
│   └── js/
│       ├── auth.js                  # Client-side session guard & role routing
│       ├── student-dashboard.js     # Student dashboard, feedback & pass management
│       ├── dashboard.js             # Organizer dashboard, session matrix & feedback
│       ├── admin.js                 # Admin management, corrections & audit trail
│       ├── attendance.js            # QR camera scanner & session attendance engine
│       ├── events.js                # Catalog browsing, filtering & proposal submission
│       └── registration.js          # Event booking & auto-fill integration
│
├── k8s/                             # Kubernetes manifests (Namespace, Deployment, HPA, Ingress)
├── Dockerfile                       # Container deployment definition
├── package.json                     # Project dependencies and npm scripts
└── README.md                        # Complete Project Documentation & Evaluation Guide
```

---

## 5. Evaluation Credentials & Demo Accounts

All demo accounts come pre-configured with active sessions, realistic departmental affiliations, and roll numbers:

| Role | Portal URL | Login Email / Roll No. | Password | Permissions & Features |
| :--- | :--- | :--- | :--- | :--- |
| **Student (Lead)** | `/login.html?role=student` | `hariharan@kct.ac.in` / `21BCS042` | `student@kct2026` | Event booking, passes, OD slip, certificates, feedback |
| **Student (Member)** | `/login.html?role=student` | `shaheer@kct.ac.in` / `21BCS043` | `student@kct2026` | Verified attendee, multi-session participant |
| **Student (Member)** | `/login.html?role=student` | `ashwanth@kct.ac.in` / `21BCS044` | `student@kct2026` | Verified attendee, certificate download |
| **Organizer** | `/login.html?role=organizer` | `organizer@kct.ac.in` | `admin@kct2026` | Propose events, scan passes, session matrix, feedback |
| **Admin** | `/login.html?role=organizer` | `admin@kct.ac.in` | `admin@kct2026` | Full system audit trail, roll number edits, corrections |

*(Clickable **Auto-Fill Demo Credentials** buttons are available directly on `/login.html` for instant login).*

---

## 6. Installation & Execution Guide

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Seed Demo Data (Optional)
```bash
npm run seed
```

### Step 3: Run the Comprehensive Test Suite
```bash
npm test
```
*Executes all 13 test groups and confirms 123 automated assertions.*

### Step 4: Start the Server
```bash
npm start
```
The server will start at:
```text
http://localhost:5000
```

---

## 7. Automated Test Suite (123 Tests Passed)

EventHub includes an automated verification suite (`backend/test_suite.js`) covering 13 core test groups:

```text
================================================================
📊 Test Execution Summary: 123 Passed, 0 Failed
================================================================
```

| Group | Category | Assertions | Status |
| :---: | :--- | :---: | :---: |
| **1** | System Health & Configuration | 4 | ✓ PASS |
| **2** | Authentication, JWT & RBAC Access Control | 13 | ✓ PASS |
| **3** | Event Proposal Lifecycle (Submit, Decline Justification, Approve) | 8 | ✓ PASS |
| **4** | Student Registration & Scoped Pass Generation | 3 | ✓ PASS |
| **5** | Attendance Scanning (Exact 5 Security Responses) | 8 | ✓ PASS |
| **6** | Admin Attendance Correction & Audit Logging | 5 | ✓ PASS |
| **7** | Student Roll Number Modification & Duplicate Block | 4 | ✓ PASS |
| **8** | Automated Email Notifications & Pass Delivery | 6 | ✓ PASS |
| **9** | Verified Certificates & Public QR Verification | 14 | ✓ PASS |
| **10** | Real-Time SSE Feed, Academic Roster & Analytics | 12 | ✓ PASS |
| **11** | Academic On-Duty (OD) Requisition & Verification | 14 | ✓ PASS |
| **12** | Post-Event Feedback & Satisfaction Analytics | 15 | ✓ PASS |
| **13** | Multi-Session / Multi-Day Hackathon Tracking | 16 | ✓ PASS |

---

## 8. Exact 5 Security Responses for Attendance Scanner

To prevent fraud, event mismatches, and duplicate check-ins, the attendance scanner enforces 5 deterministic responses:

1. **HTTP 200 OK:** `"Attendance Marked Successfully"` (Valid first-time check-in, logged with ISO timestamp).
2. **HTTP 409 Conflict:** `"Attendance Already Marked"` (Duplicate scan blocked; displays original check-in time).
3. **HTTP 404 Not Found:** `"Registration Not Found"` (Unrecognized QR ticket code).
4. **HTTP 403 Forbidden:** `"You Are Not Authorized for This Event"` (Student attempting to call scanner API or pass scanned at wrong event).
5. **HTTP 400 Bad Request:** `"Invalid or Expired QR Pass"` (Malformed or empty QR data).

---

## 9. Complete REST API Reference

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | | | |
| `POST` | `/api/auth/login` | Public | Login via Email or Roll Number (case-insensitive) |
| `POST` | `/api/auth/register` | Public | Student sign-up with college roll number |
| `GET` | `/api/auth/me` | Authenticated | Retrieve profile details of authenticated user |
| **Events & Proposals** | | | |
| `GET` | `/api/events` | Public | Approved events catalog with remaining seat counts |
| `POST` | `/api/events` | Student / Org | Submit event proposal (status: `pending`) |
| `POST` | `/api/events/:id/approve` | Org / Admin | Approve event proposal into public catalog |
| `POST` | `/api/events/:id/reject` | Org / Admin | Decline event proposal (requires mandatory reason) |
| `GET` | `/api/events/:id/academic-roster` | Org / Admin | Official Academic Roster with sign-off blocks |
| `GET` | `/api/events/:id/export-csv` | Org / Admin | Download CSV attendance spreadsheet |
| **Attendance & Live Feed** | | | |
| `POST` | `/api/attendance/mark` | Org / Admin | QR scanner attendance check-in (5 security cases) |
| `POST` | `/api/attendance/session-mark` | Org / Admin | Session-specific QR check-in |
| `GET` | `/api/attendance/live-stream` | Authenticated | Real-time Server-Sent Events (SSE) live gate feed |
| **Academic OD Slips** | | | |
| `GET` | `/api/od/request/:regId` | Student (Own) | Generate On-Duty slip (requires verified attendance) |
| `GET` | `/api/od/verify/:odId` | Public | Public verification endpoint for academic advisors |
| `GET` | `/api/od/batch/:eventId` | Org / Admin | Batch OD clearance roster for department |
| **Participation Certificates** | | | |
| `GET` | `/api/certificates/:regId` | Student (Own) | Generate participation certificate |
| `GET` | `/api/certificates/verify/:certId`| Public | Public verification of certificate authenticity |
| **Feedback Analytics** | | | |
| `POST` | `/api/feedback/submit` | Student (Verified) | Submit 5-star ratings & comments |
| `GET` | `/api/feedback/event/:id` | Org / Admin | Aggregate satisfaction ratings & reviews |
| `GET` | `/api/feedback/campus-summary` | Admin | Campus-wide satisfaction benchmark |
| **Admin Operations** | | | |
| `PUT` | `/api/admin/students/:id` | Admin | Edit student roll number (with uniqueness check) |
| `POST` | `/api/admin/attendance/correct` | Admin | Correct attendance status (requires mandatory reason) |
| `GET` | `/api/admin/audit-logs` | Admin | Query immutable system audit logs |
| `GET` | `/api/admin/emails` | Admin | View simulated email dispatch delivery logs |
