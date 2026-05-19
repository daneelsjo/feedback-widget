'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin  = require('firebase-admin');
const express = require('express');
const cors   = require('cors');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');

const validApiKeysSecret = defineSecret('VALID_API_KEYS');
const priveJoSaKeySecret  = defineSecret('PRIVE_JO_SA_KEY');

// ─── Firebase initialisatie ───────────────────────────────────────────────────
admin.initializeApp();

const bucket = admin.storage().bucket();

let _kanbanApp = null;

function getKanbanDb() {
  if (!_kanbanApp) {
    const serviceAccount = JSON.parse(process.env.PRIVE_JO_SA_KEY);
    _kanbanApp = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      'kanban',
    );
  }
  return _kanbanApp.firestore();
}

// ─── Express-app ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'] }));
app.options('*', cors());

// Firebase Functions v2 buffert de body in req.rawBody — parse die als fallback
app.use((req, res, next) => {
  if (req.rawBody && (!req.body || Object.keys(req.body).length === 0)) {
    try {
      req.body = JSON.parse(req.rawBody.toString('utf8'));
    } catch (_) {
      req.body = {};
    }
    return next();
  }
  express.json({ limit: '20mb' })(req, res, next);
});

// ─── Type → typeId mapping ────────────────────────────────────────────────────
const TYPE_IDS = {
  bug:         'MEIipj89qLCIdKNcun28',
  feature:     'MEIipj89qLCIdKNcun28',
  improvement: 'gmlEYp5mzuhs4dATwhaB',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTitle(type, description) {
  const labels = { bug: 'Bug', improvement: 'Verbetering', feature: 'Feature' };
  const first  = (description.split(/[.!?\n]/)[0] || '').trim().slice(0, 80);
  return `[${labels[type] || 'Feedback'}] ${first}`;
}

function buildDescription(body) {
  const { description, name, email, sourceSiteName, pageUrl, browserOs, resolution } = body;
  return [
    description,
    '',
    '---',
    `Gemeld door: ${name} <${email}>`,
    `Website: ${sourceSiteName || ''}`,
    `Pagina: ${pageUrl || ''}`,
    `Browser: ${browserOs || ''}`,
    `Scherm: ${resolution || ''}`,
  ].join('\n');
}

async function uploadBase64ToStorage(attachment) {
  const { name: origName, type: mimeType, data } = attachment;
  const base64 = data.includes(',') ? data.split(',')[1] : data;
  const buffer = Buffer.from(base64, 'base64');
  const ext      = path.extname(origName) || '';
  const token    = uuidv4();
  const fileName = `feedback/${Date.now()}-${token}${ext}`;
  const fileRef  = bucket.file(fileName);

  await fileRef.save(buffer, {
    metadata: {
      contentType: mimeType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(fileName)}`;
}

// ─── Route: POST / ────────────────────────────────────────────────────────────
app.post('/', async (req, res) => {
  // API-sleutel validatie
  const providedKey = req.headers['x-api-key'] || '';
  const validKeys   = (process.env.VALID_API_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);

  if (!providedKey || !validKeys.includes(providedKey)) {
    return res.status(401).json({ message: 'Ongeldige of ontbrekende API-sleutel.' });
  }

  const { type, name, email, description, boardId, statusId,
          sourceSiteName, pageOrigin, pageUrl, browserOs, resolution,
          attachment } = req.body;

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
    let attachmentUrl = null;
    if (attachment && attachment.data) {
      attachmentUrl = await uploadBase64ToStorage(attachment);
    }

    const db    = getKanbanDb();
    const typeId = TYPE_IDS[type] || TYPE_IDS.bug;
    const uid    = uuidv4();
    const now    = admin.firestore.FieldValue.serverTimestamp();

    const card = {
      boardId:     boardId  || 'XOhvgrJn3VYr7mR6vjsG',
      columnId:    statusId || 'NouTYAysQ5KsQkqGWXRx',
      cardPage:    'Workflow',
      cardColor:   null,
      title:       buildTitle(type, description),
      description: buildDescription({ description, name, email, sourceSiteName, pageUrl, browserOs, resolution }),
      typeId,
      tags:        [typeId],
      uid,
      priorityId:  null,
      dueDate:     null,
      checklist:   [],
      subtasks:    [],
      links:       attachmentUrl ? [{ label: 'Bijlage', url: attachmentUrl }] : [],
      logs:        [],
      createdAt:   now,
      updatedAt:   now,
    };

    const docRef = await db.collection('workflowCards').add(card);

    return res.status(201).json({ message: 'Feedback succesvol ontvangen.', ticketId: docRef.id });
  } catch (err) {
    console.error('[feedbackApi]', err);
    return res.status(500).json({ message: 'Interne serverfout.' });
  }
});

// ─── Cloud Function export (Gen 2) ───────────────────────────────────────────
exports.feedbackApi = onRequest(
  {
    secrets: [validApiKeysSecret, priveJoSaKeySecret],
    region: 'europe-west1',
  },
  app,
);
