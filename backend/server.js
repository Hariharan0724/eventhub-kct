const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

const { getFirestore, isLiveFirestore } = require('./firebase');
const seedData = require('./seed');

// Initialize database
const db = getFirestore();

// Automatically seed sample data if database is empty
seedData(false).catch(err => console.error('Database auto-seed check:', err));

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Static files (Frontend)
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// API Routes
app.use('/api/events', require('./routes/events'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/od', require('./routes/od'));
app.use('/api/feedback', require('./routes/feedback'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'EventHub KCT Attendance Management System',
    timestamp: new Date().toISOString(),
    database: isLiveFirestore() ? 'Firebase Firestore (Cloud)' : 'Persistent Firestore Document Store (Local)',
    version: '1.0.0'
  });
});

// Fallback for SPA or unknown HTML route requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  const fs = require('fs');
  const filePath = path.join(frontendPath, req.path.endsWith('.html') ? req.path : `${req.path}.html`);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error occurred. Please try again later.'
  });
});

// Start Server
let serverInstance = null;
if (require.main === module) {
  serverInstance = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 EventHub Server running on http://localhost:${PORT}`);
    console.log(`🎓 Kumaraguru College of Technology (KCT), Coimbatore`);
    console.log(`📊 Mode: ${isLiveFirestore() ? 'Firebase Firestore (Cloud)' : 'Local Firestore Document Store'}`);
    console.log(`🌐 Student Portal: http://localhost:${PORT}/index.html`);
    console.log(`🛡 Organizer Portal: http://localhost:${PORT}/login.html`);
    console.log(`=======================================================`);
  });
}

module.exports = { app, getServer: () => serverInstance };
