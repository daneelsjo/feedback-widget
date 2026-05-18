/**
 * Feedback Widget — Backend API Route
 *
 * Gebruik als Express router:
 *   const feedbackRoute = require('./api-route');
 *   app.use('/api/feedback', feedbackRoute);
 *
 * Vereiste npm packages:
 *   npm install express cors multer firebase-admin uuid
 *
 * Vereiste omgevingsvariabelen (.env):
 *   FIREBASE_STORAGE_BUCKET=jouw-project.appspot.com
 *   VALID_API_KEYS=sleutel1,sleutel2
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 *     (of gebruik FIREBASE_SERVICE_ACCOUNT_JSON voor een inline JSON-string)
 */

'use strict';

const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const admin     = require('firebase-admin');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ─── Firebase initialisatie (eenmalig, guard voor hot-reload) ────────────────
if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Inline JSON (handig op serverless platforms zoals Vercel/Railway)
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Bestandspad via GOOGLE_APPLICATION_CREDENTIALS of standaard serviceAccountKey.json
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({
    credential,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db     = admin.firestore();
const bucket = admin.storage().bucket();

// ─── CORS ────────────────────────────────────────────────────────────────────
// Staat requests toe van willekeurige origins (widgets op externe websites).
// Vervang '*' door een array van toegestane domeinen voor extra beveiliging.
router.use(cors({
  origin: '*',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));
router.options('*', cors()); // Pre-flight requests

// ─── Multer (multipart/form-data + bestandsupload) ───────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // max 10 MB
  fileFilter(_req, file, cb) {
    const allowed = /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/pdf|text\/(plain|csv))$/;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Bestandstype niet toegestaan.'), { status: 415 }));
    }
  },
});

// ─── Middleware: API-sleutel validatie ────────────────────────────────────────
function validateApiKey(req, res, next) {
  const providedKey = req.headers['x-api-key'] || '';
  const validKeys   = (process.env.VALID_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  if (!providedKey || !validKeys.includes(providedKey)) {
    return res.status(401).json({ message: 'Ongeldige of ontbrekende API-sleutel.' });
  }
  next();
}

// ─── Helper: ticket-titel genereren ──────────────────────────────────────────
function buildTitle(type, description) {
  const labels = { bug: 'Bug', improvement: 'Verbetering', feature: 'Feature' };
  const label  = labels[type] || 'Feedback';
  // Eerste zin, afgekapt op 80 tekens
  const first  = (description.split(/[.!?\n]/)[0] || '').trim().slice(0, 80);
  return `[${label}] ${first}`;
}

// ─── Helper: bestand uploaden naar Firebase Storage ──────────────────────────
async function uploadToStorage(file) {
  const ext      = path.extname(file.originalname) || '';
  const token    = uuidv4();
  const fileName = `feedback/${Date.now()}-${token}${ext}`;
  const fileRef  = bucket.file(fileName);

  await fileRef.save(file.buffer, {
    metadata: {
      contentType: file.mimetype,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  // Publieke download-URL (werkt wanneer de Storage-bucket publiek leesbaar is)
  // Gebruik getSignedUrl() als de bucket privé moet blijven.
  const bucketName = bucket.name;
  return `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(fileName)}`;
}

// ─── POST /api/feedback ───────────────────────────────────────────────────────
router.post(
  '/',
  validateApiKey,
  upload.single('attachment'),
  async (req, res) => {
    try {
      const {
        type,
        name,
        email,
        description,
        boardId,
        statusId,
        sourceSiteName,
        pageOrigin,
        pageUrl,
        browserOs,
        resolution,
      } = req.body;

      // ── Server-side validatie ──
      const missing = [];
      if (!type)        missing.push('type');
      if (!name)        missing.push('name');
      if (!email)       missing.push('email');
      if (!description) missing.push('description');

      if (missing.length) {
        return res.status(400).json({
          message: `Verplichte velden ontbreken: ${missing.join(', ')}.`,
        });
      }

      const VALID_TYPES = ['bug', 'improvement', 'feature'];
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ message: 'Ongeldig type opgegeven.' });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Ongeldig e-mailadres.' });
      }

      // ── Bijlage uploaden (optioneel) ──
      let attachmentUrl = null;
      if (req.file) {
        attachmentUrl = await uploadToStorage(req.file);
      }

      // ── Firestore-document aanmaken ──
      const ticket = {
        board_id:  boardId  || '',
        status_id: statusId || '',
        type,
        title:       buildTitle(type, description),
        description,
        reporter: {
          name,
          email,
        },
        metadata: {
          source_site: sourceSiteName || pageOrigin || '',
          url:         pageUrl        || '',
          browser_os:  browserOs      || '',
          resolution:  resolution     || '',
        },
        attachment_url: attachmentUrl,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection('tickets').add(ticket);

      return res.status(201).json({
        message: 'Feedback succesvol ontvangen.',
        ticketId: docRef.id,
      });

    } catch (err) {
      console.error('[FeedbackAPI] Fout bij verwerken:', err);

      // Multer bestandstype-fout
      if (err.status === 415) {
        return res.status(415).json({ message: err.message });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'Bestand is te groot (max 10 MB).' });
      }

      return res.status(500).json({ message: 'Interne serverfout. Probeer later opnieuw.' });
    }
  },
);

module.exports = router;
