'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin  = require('firebase-admin');
const express = require('express');
const cors   = require('cors');
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');

// ─── Firebase initialisatie ───────────────────────────────────────────────────
// Standaard app: feedback-widget-f0087 → Storage (bijlagen)
admin.initializeApp();

// Tweede app: prive-jo → Firestore (Kanban-tickets)
// De service account van feedback-widget-f0087 moet in prive-jo de rol
// "Cloud Datastore User" hebben (zie IMPLEMENTATIE.md voor instructies).
const kanbanApp = admin.initializeApp({ projectId: 'prive-jo' }, 'kanban');

const db     = kanbanApp.firestore();
const bucket = admin.storage().bucket();

// ─── Secret: komma-gescheiden lijst van geldige API-sleutels ─────────────────
// Stel in via: firebase functions:secrets:set VALID_API_KEYS
const validApiKeysSecret = defineSecret('VALID_API_KEYS');

// ─── Express-app ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'] }));
app.options('*', cors());

// ─── Multer ───────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/pdf|text\/(plain|csv))$/;
    cb(
      allowed.test(file.mimetype)
        ? null
        : Object.assign(new Error('Bestandstype niet toegestaan.'), { status: 415 }),
      allowed.test(file.mimetype),
    );
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTitle(type, description) {
  const labels = { bug: 'Bug', improvement: 'Verbetering', feature: 'Feature' };
  const first  = (description.split(/[.!?\n]/)[0] || '').trim().slice(0, 80);
  return `[${labels[type] || 'Feedback'}] ${first}`;
}

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

  return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(fileName)}`;
}

// ─── Route: POST / ────────────────────────────────────────────────────────────
app.post('/', upload.single('attachment'), async (req, res) => {
  // API-sleutel validatie
  const providedKey = req.headers['x-api-key'] || '';
  const validKeys   = (process.env.VALID_API_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);

  if (!providedKey || !validKeys.includes(providedKey)) {
    return res.status(401).json({ message: 'Ongeldige of ontbrekende API-sleutel.' });
  }

  const { type, name, email, description, boardId, statusId,
          sourceSiteName, pageOrigin, pageUrl, browserOs, resolution } = req.body;

  // Validatie
  const missing = ['type','name','email','description'].filter(f => !req.body[f]);
  if (missing.length) {
    return res.status(400).json({ message: `Verplichte velden ontbreken: ${missing.join(', ')}.` });
  }
  if (!['bug','improvement','feature'].includes(type)) {
    return res.status(400).json({ message: 'Ongeldig type.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Ongeldig e-mailadres.' });
  }

  try {
    const attachmentUrl = req.file ? await uploadToStorage(req.file) : null;

    const docRef = await db.collection('tickets').add({
      board_id:    boardId  || '',
      status_id:   statusId || '',
      type,
      title:       buildTitle(type, description),
      description,
      reporter:    { name, email },
      metadata: {
        source_site: sourceSiteName || pageOrigin || '',
        url:         pageUrl        || '',
        browser_os:  browserOs      || '',
        resolution:  resolution     || '',
      },
      attachment_url: attachmentUrl,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ message: 'Feedback succesvol ontvangen.', ticketId: docRef.id });
  } catch (err) {
    console.error('[feedbackApi]', err);
    if (err.status === 415) return res.status(415).json({ message: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Bestand te groot (max 10 MB).' });
    return res.status(500).json({ message: 'Interne serverfout.' });
  }
});

// ─── Cloud Function export ────────────────────────────────────────────────────
exports.feedbackApi = onRequest(
  {
    secrets: [validApiKeysSecret],
    region: 'europe-west1',
    cors: true,
  },
  app,
);
