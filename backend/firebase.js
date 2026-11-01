/**
 * EventHub - Firebase Firestore Configuration & Persistence Adapter
 * 
 * Supports:
 * 1. Official Google Cloud / Firebase Admin SDK Firestore (via service account or env variables)
 * 2. High-performance Persistent Local Firestore Adapter (data/firestore_db.json)
 *    which guarantees immediate out-of-the-box operation and data persistence across restarts
 *    without crashing when external cloud credentials are not yet configured.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

let dbInstance = null;
let isRealFirestore = false;

// Path to local persistent store
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'firestore_db.json');

/**
 * Local Firestore-compatible Collection Reference
 */
class LocalDocumentReference {
  constructor(collectionRef, docId) {
    this.collectionRef = collectionRef;
    this.id = docId;
  }

  async get() {
    const data = this.collectionRef.storage[this.collectionRef.name]?.[this.id];
    return {
      id: this.id,
      exists: data !== undefined,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
    };
  }

  async set(data, options = {}) {
    if (!this.collectionRef.storage[this.collectionRef.name]) {
      this.collectionRef.storage[this.collectionRef.name] = {};
    }
    const current = options.merge
      ? (this.collectionRef.storage[this.collectionRef.name][this.id] || {})
      : {};
    this.collectionRef.storage[this.collectionRef.name][this.id] = {
      ...current,
      ...JSON.parse(JSON.stringify(data))
    };
    this.collectionRef.save();
    return { id: this.id };
  }

  async update(updates) {
    if (!this.collectionRef.storage[this.collectionRef.name]?.[this.id]) {
      throw new Error(`Document ${this.id} does not exist in ${this.collectionRef.name}`);
    }
    this.collectionRef.storage[this.collectionRef.name][this.id] = {
      ...this.collectionRef.storage[this.collectionRef.name][this.id],
      ...JSON.parse(JSON.stringify(updates))
    };
    this.collectionRef.save();
    return { id: this.id };
  }

  async delete() {
    if (this.collectionRef.storage[this.collectionRef.name]?.[this.id]) {
      delete this.collectionRef.storage[this.collectionRef.name][this.id];
      this.collectionRef.save();
    }
    return { success: true };
  }
}

class LocalQuery {
  constructor(collectionRef, filters = [], orderRules = []) {
    this.collectionRef = collectionRef;
    this.filters = filters;
    this.orderRules = orderRules;
  }

  where(field, op, value) {
    return new LocalQuery(this.collectionRef, [...this.filters, { field, op, value }], this.orderRules);
  }

  orderBy(field, direction = 'asc') {
    return new LocalQuery(this.collectionRef, this.filters, [...this.orderRules, { field, direction }]);
  }

  async get() {
    const colData = this.collectionRef.storage[this.collectionRef.name] || {};
    let docs = Object.keys(colData).map(id => ({
      id,
      ref: this.collectionRef.doc(id),
      exists: true,
      data: () => JSON.parse(JSON.stringify(colData[id]))
    }));

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter(doc => {
        const val = doc.data()[filter.field];
        if (filter.op === '==' || filter.op === '===') {
          return val === filter.value;
        }
        if (filter.op === '!=') {
          return val !== filter.value;
        }
        if (filter.op === 'in') {
          return Array.isArray(filter.value) && filter.value.includes(val);
        }
        if (filter.op === '>') {
          return val > filter.value;
        }
        if (filter.op === '>=') {
          return val >= filter.value;
        }
        if (filter.op === '<') {
          return val < filter.value;
        }
        if (filter.op === '<=') {
          return val <= filter.value;
        }
        return true;
      });
    }

    // Apply sorting
    for (const rule of this.orderRules) {
      docs.sort((a, b) => {
        const valA = a.data()[rule.field];
        const valB = b.data()[rule.field];
        if (valA < valB) return rule.direction === 'desc' ? 1 : -1;
        if (valA > valB) return rule.direction === 'desc' ? -1 : 1;
        return 0;
      });
    }

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs
    };
  }
}

class LocalCollectionReference extends LocalQuery {
  constructor(adapter, name) {
    super(null, [], []);
    this.collectionRef = this;
    this.adapter = adapter;
    this.name = name;
  }

  get storage() {
    return this.adapter.dbData;
  }

  save() {
    this.adapter.save();
  }

  doc(id) {
    const docId = id || 'doc_' + Math.random().toString(36).substring(2, 10);
    return new LocalDocumentReference(this, docId);
  }

  async add(data) {
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const docRef = this.doc(docId);
    await docRef.set(data);
    return docRef;
  }
}

class LocalFirestoreAdapter {
  constructor() {
    this.dbData = {
      users: {},
      events: {},
      registrations: {},
      attendance: {},
      auditLogs: {},
      organizers: {}
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(LOCAL_DB_PATH)) {
        const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
        this.dbData = JSON.parse(raw);
        this.dbData.users = this.dbData.users || {};
        this.dbData.events = this.dbData.events || {};
        this.dbData.registrations = this.dbData.registrations || {};
        this.dbData.attendance = this.dbData.attendance || {};
        this.dbData.auditLogs = this.dbData.auditLogs || {};
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Error reading local firestore data file, initializing empty store:', err.message);
      this.save();
    }
  }

  save() {
    try {
      const dir = path.dirname(LOCAL_DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(this.dbData, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving local firestore data:', err.message);
    }
  }

  collection(name) {
    return new LocalCollectionReference(this, name);
  }
}

/**
 * Initialize Firestore connection
 */
function initFirestore() {
  if (dbInstance) return dbInstance;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    try {
      const admin = require('firebase-admin');
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || projectId
      });
      dbInstance = admin.firestore();
      isRealFirestore = true;
      console.log(' [Firebase] Successfully connected to live Firebase Firestore via Service Account!');
      return dbInstance;
    } catch (err) {
      console.warn(' [Firebase] Failed to initialize live Firebase Firestore with Service Account:', err.message);
    }
  } else if (projectId && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      const admin = require('firebase-admin');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      dbInstance = admin.firestore();
      isRealFirestore = true;
      console.log(' [Firebase] Successfully connected to live Firebase Firestore via environment variables!');
      return dbInstance;
    } catch (err) {
      console.warn(' [Firebase] Failed to initialize live Firebase Firestore with env vars:', err.message);
    }
  }

  // In production, do not silently fall back to mock data
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Production environment requires valid Firebase Firestore configuration (FIREBASE_SERVICE_ACCOUNT_PATH or credentials in environment). Fallback to local store is disallowed.');
  }

  // Development & local evaluation fallback to persistent local store
  console.log(' [Firestore] Operating with Persistent Firestore Document Store (' + LOCAL_DB_PATH + ')');
  console.log(' [Firestore] To connect to Firebase Cloud, configure FIREBASE_SERVICE_ACCOUNT_PATH or env credentials in .env');
  dbInstance = new LocalFirestoreAdapter();
  isRealFirestore = false;
  return dbInstance;
}

module.exports = {
  getFirestore: initFirestore,
  isLiveFirestore: () => isRealFirestore
};
