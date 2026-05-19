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

// ─── Body parser: werkt in alle Cloud Run scenario's ─────────────────────────
// Firebase v2 buffert de body op drie mogelijke plaatsen — we proberen alle drie.
async function parseJsonBody(req) {
  // 1. Al geparsd door het framework
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length > 0) {
    return req.body;
  }
  // 2. rawBody buffer (Firebase v1-stijl, soms aanwezig in v2)
  const raw = req.rawBody;
  if (raw && raw.length > 0) {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  }
  // 3. Lees rechtstreeks van de request-stream
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(text)); }
      catch (e) { reject(new Error('Ongeldige JSON in request body')); }
    });
    req.on('error', reject);
  });
}

// ─── Express-app ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'] }));
app.options('*', cors());

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

function buildDescription(b) {
  return [
    b.description, '',
    '---',
    `Gemeld door: ${b.name} <${b.email}>`,
    `Website: ${b.sourceSiteName || ''}`,
    `Pagina: ${b.pageUrl || ''}`,
    `Browser: ${b.browserOs || ''}`,
    `Scherm: ${b.resolution || ''}`,
  ].join('\n');
}

async function uploadBase64ToStorage(attachment) {
  const base64   = attachment.data.includes(',') ? attachment.data.split(',')[1] : attachment.data;
  const buffer   = Buffer.from(base64, 'base64');
  const ext      = path.extname(attachment.name) || '';
  const token    = uuidv4();
  const fileName = `feedback/${Date.now()}-${token}${ext}`;
  const fileRef  = bucket.file(fileName);
  await fileRef.save(buffer, {
    metadata: { contentType: attachment.type, metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(fileName)}`;
}

// ─── Route: POST / ────────────────────────────────────────────────────────────
app.post('/', async (req, res) => {
  // Body parsen
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    console.error('[feedbackApi] Body parse error:', e.message);
    return res.status(400).json({ message: 'Ongeldige request body.' });
  }

  // API-sleutel validatie
  const providedKey = req.headers['x-api-key'] || '';
  const validKeys   = (process.env.VALID_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!providedKey || !validKeys.includes(providedKey)) {
    return res.status(401).json({ message: 'Ongeldige of ontbrekende API-sleutel.' });
  }

  const { type, name, email, description, boardId, statusId,
          sourceSiteName, pageUrl, browserOs, resolution, attachment } = body;

  // Validatie
  const missing = ['type','name','email','description'].filter(f => !body[f]);
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

    const db     = getKanbanDb();
    const typeId = TYPE_IDS[type] || TYPE_IDS.bug;
    const uid    = uuidv4();
    const now    = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('workflowCards').add({
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
    });

    return res.status(201).json({ message: 'Feedback succesvol ontvangen.' });
  } catch (err) {
    console.error('[feedbackApi] Fout:', err);
    return res.status(500).json({ message: 'Interne serverfout.' });
  }
});

// ─── Cloud Function export (Gen 2) ───────────────────────────────────────────
exports.feedbackApi = onRequest(
  { secrets: [validApiKeysSecret, priveJoSaKeySecret], region: 'europe-west1' },
  app,
);
