'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin  = require('firebase-admin');
const express = require('express');
const cors   = require('cors');

const validApiKeysSecret = defineSecret('VALID_API_KEYS');
const priveJoSaKeySecret  = defineSecret('PRIVE_JO_SA_KEY');

// ─── Firebase initialisatie ───────────────────────────────────────────────────
admin.initializeApp();

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
app.use(express.raw({ type: '*/*', limit: '5mb' }));

// ─── Type → typeId mapping ────────────────────────────────────────────────────
const TYPE_IDS = {
  bug:         'MEIipj89qLCIdKNcun28',
  feature:     'YKK54Dw5nureM74oat4q',
  improvement: 'gmlEYp5mzuhs4dATwhaB',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTitle(type, subject) {
  const labels = { bug: 'Bug', improvement: 'Verbetering', feature: 'Feature' };
  return `[${labels[type] || 'Feedback'}] ${subject}`;
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

// ─── Route: POST / ────────────────────────────────────────────────────────────
app.post('/', async (req, res) => {
  // Body parsen
  let body;
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      body = JSON.parse(req.body.toString('utf8'));
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      body = req.body;
    } else {
      throw new Error('Lege body');
    }
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

  const { type, subject, name, email, description, boardId, statusId,
          ownerUid, siteTagId, sourceSiteName, pageUrl, browserOs, resolution } = body;

  // Validatie
  const missing = ['type','subject','name','email','description'].filter(f => !body[f]);
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
    const db     = getKanbanDb();
    const typeId = TYPE_IDS[type] || TYPE_IDS.bug;
    const uid    = ownerUid || 'KNjbJuZV1MZMEUQKsViehVhW3832';
    const now    = admin.firestore.FieldValue.serverTimestamp();

    // Tags: typeId altijd, siteTagId enkel als meegegeven
    const tags = siteTagId ? [typeId, siteTagId] : [typeId];

    await db.collection('workflowCards').add({
      boardId:     boardId  || 'XOhvgrJn3VYr7mR6vjsG',
      columnId:    statusId || 'NouTYAysQ5KsQkqGWXRx',
      cardPage:    null,
      cardColor:   null,
      title:       buildTitle(type, subject),
      description: buildDescription({ description, name, email, sourceSiteName, pageUrl, browserOs, resolution }),
      typeId,
      tags,
      uid,
      priorityId:  null,
      dueDate:     null,
      checklist:   [],
      subtasks:    [],
      links:       [],
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
