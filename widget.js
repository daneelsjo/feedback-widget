/**
 * Feedback Widget — Universele feedback/bug-rapportage Web Component
 * Host op GitHub en laad via jsDelivr CDN.
 *
 * Vereist: window.FeedbackWidgetConfig vóór het laden van dit script.
 *
 * Config opties:
 *   apiUrl         — URL van de Cloud Function
 *   apiKey         — geheime API-sleutel
 *   boardId        — Firestore ID van het Kanban-bord
 *   statusId       — Firestore ID van de "Nieuw"-kolom
 *   ownerUid       — Firebase Auth UID van de bord-eigenaar
 *
 * Domeinnaam → siteTagId mapping: zie SITE_TAGS hieronder.
 * Voeg per website een regel toe: 'jouwdomein.be': 'FIRESTORE_TAG_ID'
 */
(function () {
  'use strict';

  // ─── Domeinnaam → Kanban tag-ID ───────────────────────────────────────────────
  // Voeg hier per website een regel toe. De domeinnaam is zonder www en zonder https.
  // Voorbeeld: 'mijnwebsite.be': 'abc123tagId'
  const SITE_TAGS = {
    'localhost':        '9UL9hXvhnrjm3ulil59B',       // lokaal testen
    'prive-jo.web.app':  'Tds44nUDMQq8XD1BKAKg',
    'optech-jo.web.app':           '9X8gSwm8hRyzLQimv2S6',
  };

  const config = window.FeedbackWidgetConfig;
  if (!config || !config.apiUrl) {
    console.warn('[FeedbackWidget] Geen geldige window.FeedbackWidgetConfig gevonden. Widget wordt niet geladen.');
    return;
  }

  // Haal siteTagId op uit mapping (hostname zonder www)
  const hostname = window.location.hostname.replace(/^www\./, '');
  const siteTagId = SITE_TAGS[hostname] || '';

  // ─── Styles ──────────────────────────────────────────────────────────────────
  const STYLE = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #111827;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .trigger-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 50px;
      padding: 12px 20px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      box-shadow: 0 4px 14px rgba(79,70,229,.4);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background .2s, box-shadow .2s, transform .2s;
    }
    .trigger-btn:hover {
      background: #4338ca;
      box-shadow: 0 6px 20px rgba(79,70,229,.5);
      transform: translateY(-1px);
    }

    .panel {
      position: fixed;
      bottom: 84px;
      right: 24px;
      z-index: 2147483646;
      width: 360px;
      max-width: calc(100vw - 48px);
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,.15), 0 4px 16px rgba(0,0,0,.08);
      overflow: hidden;
      transform: scale(.95) translateY(10px);
      opacity: 0;
      pointer-events: none;
      transition: transform .22s cubic-bezier(.34,1.56,.64,1), opacity .18s ease;
    }
    .panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    .panel-header {
      background: #4f46e5;
      color: #fff;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-header h2 { font-size: 15px; font-weight: 600; }
    .close-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      opacity: .8;
      display: flex;
      align-items: center;
      transition: opacity .15s;
    }
    .close-btn:hover { opacity: 1; }

    .panel-body {
      padding: 18px 18px 20px;
      max-height: 72vh;
      overflow-y: auto;
    }

    .field { margin-bottom: 14px; }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 5px;
      letter-spacing: .01em;
    }
    label .req { color: #ef4444; margin-left: 2px; }

    select,
    input[type="text"],
    input[type="email"],
    textarea {
      width: 100%;
      padding: 8px 11px;
      border: 1.5px solid #e5e7eb;
      border-radius: 8px;
      font-size: 13.5px;
      font-family: inherit;
      color: #111827;
      background: #f9fafb;
      outline: none;
      transition: border-color .15s, background .15s;
      -webkit-appearance: none;
    }
    select:focus,
    input[type="text"]:focus,
    input[type="email"]:focus,
    textarea:focus {
      border-color: #4f46e5;
      background: #fff;
    }
    textarea { resize: vertical; min-height: 90px; line-height: 1.5; }

    .hp-field {
      position: absolute;
      left: -9999px;
      top: -9999px;
      height: 0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }

    .submit-btn {
      width: 100%;
      padding: 10px;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      margin-top: 6px;
      transition: background .15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .submit-btn:hover:not(:disabled) { background: #4338ca; }
    .submit-btn:disabled { opacity: .65; cursor: not-allowed; }

    .error-msg {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      padding: 9px 13px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 10px;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: fw-spin .65s linear infinite;
      flex-shrink: 0;
    }
    @keyframes fw-spin { to { transform: rotate(360deg); } }

    .success-view { text-align: center; padding: 36px 18px 28px; }
    .success-icon {
      width: 54px;
      height: 54px;
      background: #d1fae5;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 14px;
    }
    .success-title { font-size: 17px; font-weight: 600; color: #111827; margin-bottom: 8px; }
    .success-text  { color: #6b7280; font-size: 13.5px; line-height: 1.6; }
  `;

  // ─── HTML template ────────────────────────────────────────────────────────────
  const TEMPLATE = `
    <button class="trigger-btn" id="triggerBtn" aria-haspopup="dialog" aria-expanded="false" aria-label="Feedback geven">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      Feedback
    </button>

    <div class="panel" id="panel" role="dialog" aria-modal="true" aria-label="Feedback formulier" aria-hidden="true">
      <div class="panel-header">
        <h2>Feedback &amp; Bug Report</h2>
        <button class="close-btn" id="closeBtn" aria-label="Formulier sluiten">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="panel-body" id="panelBody">
        <form id="feedbackForm" novalidate>

          <div class="field">
            <label for="fw-type">Type<span class="req" aria-hidden="true">*</span></label>
            <select id="fw-type" name="type" required>
              <option value="">— Selecteer type —</option>
              <option value="bug">Bug melden</option>
              <option value="improvement">Verbetering voorstellen</option>
              <option value="feature">Feature aanvragen</option>
            </select>
          </div>

          <div class="field">
            <label for="fw-subject">Onderwerp<span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="fw-subject" name="subject" placeholder="Korte omschrijving van het probleem" required />
          </div>

          <div class="field">
            <label for="fw-name">Naam<span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="fw-name" name="name" placeholder="Jouw naam" required autocomplete="name" />
          </div>

          <div class="field">
            <label for="fw-email">E-mailadres<span class="req" aria-hidden="true">*</span></label>
            <input type="email" id="fw-email" name="email" placeholder="jouw@email.be" required autocomplete="email" />
          </div>

          <div class="field">
            <label for="fw-desc">Omschrijving<span class="req" aria-hidden="true">*</span></label>
            <textarea id="fw-desc" name="description" placeholder="Beschrijf zo duidelijk mogelijk wat je hebt gevonden of wat je wilt verbeteren…" required></textarea>
          </div>

          <!-- Honeypot -->
          <div class="hp-field" aria-hidden="true">
            <label for="fw-hp">Website</label>
            <input type="text" id="fw-hp" name="website" tabindex="-1" autocomplete="off" />
          </div>

          <button type="submit" class="submit-btn" id="submitBtn">Versturen</button>
          <div id="errorContainer" role="alert" aria-live="assertive"></div>
        </form>
      </div>
    </div>
  `;

  // ─── Web Component ────────────────────────────────────────────────────────────
  class FeedbackWidget extends HTMLElement {
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: 'closed' });
      this._isOpen = false;
    }

    connectedCallback() {
      const root = document.createElement('div');
      root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
      this._shadow.appendChild(root);

      this._panel          = this._shadow.getElementById('panel');
      this._triggerBtn     = this._shadow.getElementById('triggerBtn');
      this._closeBtn       = this._shadow.getElementById('closeBtn');
      this._form           = this._shadow.getElementById('feedbackForm');
      this._submitBtn      = this._shadow.getElementById('submitBtn');
      this._panelBody      = this._shadow.getElementById('panelBody');
      this._errorContainer = this._shadow.getElementById('errorContainer');

      this._triggerBtn.addEventListener('click', () => this._toggle());
      this._closeBtn.addEventListener('click',   () => this._close());
      this._form.addEventListener('submit',      (e) => this._submit(e));

      document.addEventListener('click', (e) => {
        if (this._isOpen && !this.contains(e.target)) this._close();
      });
    }

    _toggle() { this._isOpen ? this._close() : this._openPanel(); }

    _openPanel() {
      this._isOpen = true;
      this._panel.classList.add('open');
      this._panel.setAttribute('aria-hidden', 'false');
      this._triggerBtn.setAttribute('aria-expanded', 'true');
    }

    _close() {
      this._isOpen = false;
      this._panel.classList.remove('open');
      this._panel.setAttribute('aria-hidden', 'true');
      this._triggerBtn.setAttribute('aria-expanded', 'false');
    }

    async _submit(e) {
      e.preventDefault();

      const hp = this._shadow.getElementById('fw-hp');
      if (hp && hp.value !== '') { this._showSuccess(); return; }

      const type        = this._shadow.getElementById('fw-type').value;
      const subject     = this._shadow.getElementById('fw-subject').value.trim();
      const name        = this._shadow.getElementById('fw-name').value.trim();
      const email       = this._shadow.getElementById('fw-email').value.trim();
      const description = this._shadow.getElementById('fw-desc').value.trim();

      if (!type || !subject || !name || !email || !description) {
        this._showError('Vul alle verplichte velden in.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this._showError('Voer een geldig e-mailadres in.');
        return;
      }

      this._setLoading(true);
      this._clearError();

      const payload = {
        type,
        subject,
        name,
        email,
        description,
        boardId:        config.boardId        || '',
        statusId:       config.statusId       || '',
        ownerUid:       config.ownerUid       || '',
        siteTagId:      siteTagId,
        sourceSiteName: config.sourceSiteName || window.location.hostname,
        pageOrigin:     window.location.origin,
        pageUrl:        window.location.href,
        browserOs:      navigator.userAgent,
        resolution:     window.innerWidth + 'x' + window.innerHeight,
      };

      try {
        const res = await fetch(config.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.apiKey || '',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || `Serverfout (${res.status})`);
        }

        this._showSuccess();
      } catch (err) {
        this._showError('Er is een fout opgetreden. Probeer het later opnieuw.');
        console.error('[FeedbackWidget]', err);
      } finally {
        this._setLoading(false);
      }
    }

    _setLoading(on) {
      this._submitBtn.disabled = on;
      this._submitBtn.innerHTML = on
        ? '<span class="spinner" aria-hidden="true"></span> Versturen…'
        : 'Versturen';
    }

    _showError(msg) {
      this._errorContainer.innerHTML = `<div class="error-msg">${msg}</div>`;
    }

    _clearError() { this._errorContainer.innerHTML = ''; }

    _showSuccess() {
      this._panelBody.innerHTML = `
        <div class="success-view">
          <div class="success-icon" aria-hidden="true">
            <svg width="26" height="26" fill="none" stroke="#059669" stroke-width="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p class="success-title">Bedankt voor je feedback!</p>
          <p class="success-text">We hebben je bericht goed ontvangen en nemen het zo snel mogelijk in behandeling.</p>
        </div>
      `;
    }
  }

  if (!customElements.get('feedback-widget')) {
    customElements.define('feedback-widget', FeedbackWidget);
  }

  function mount() {
    if (!document.querySelector('feedback-widget')) {
      document.body.appendChild(document.createElement('feedback-widget'));
    }
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', mount)
    : mount();
})();
