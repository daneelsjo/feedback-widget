# Implementatie-instructies — Feedback Widget

## 1. Backend opzetten (Kanban-website)

### Packages installeren
```bash
npm install express cors multer firebase-admin uuid dotenv
```

### Firebase Service Account
1. Ga naar **Firebase Console → Projectinstellingen → Serviceaccounts**
2. Klik op **Nieuwe privésleutel genereren** → sla op als `serviceAccountKey.json`
3. Zet dit bestand **nooit** in een publieke Git-repository

### .env aanmaken
```env
FIREBASE_STORAGE_BUCKET=jouw-project-id.appspot.com
VALID_API_KEYS=sleutel_website_a,sleutel_website_b
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

> **Tip voor Vercel / Railway:** Gebruik `FIREBASE_SERVICE_ACCOUNT_JSON` met de volledige JSON-inhoud als één string.

### Route koppelen in server.js
```javascript
require('dotenv').config();
const express = require('express');
const app = express();

const feedbackRoute = require('./api-route');
app.use('/api/feedback', feedbackRoute);

app.listen(3000, () => console.log('Server draait op poort 3000'));
```

---

## 2. Widget op een externe website plaatsen

Plak het onderstaande snippet in de `<head>` of vlak voor `</body>`:

```html
<!-- Stap 1: Configuratie (pas aan per website) -->
<script>
  window.FeedbackWidgetConfig = {
    apiUrl:         "https://jouw-kanban-website.com/api/feedback",
    apiKey:         "sleutel_website_a",          // uniek per externe site
    boardId:        "ID_VAN_HET_KANBAN_BORD",
    statusId:       "ID_VAN_KOLOM_NIEUW",
    sourceSiteName: "Naam van de Externe Website"
  };
</script>

<!-- Stap 2: Widget laden via jsDelivr CDN -->
<script
  src="https://cdn.jsdelivr.net/gh/JOUW-GITHUB-USERNAME/JOUW-REPO@main/widget.js"
  defer
></script>
```

> Vervang `JOUW-GITHUB-USERNAME` en `JOUW-REPO` door jouw GitHub-gegevens.  
> Gebruik een versietag (bijv. `@v1.0.0`) in productie voor cache-controle.

---

## 3. Widget hosten op GitHub + CDN

1. Push `widget.js` naar een publieke GitHub-repository
2. Maak een release-tag aan: `git tag v1.0.0 && git push --tags`
3. jsDelivr-URL wordt automatisch: `https://cdn.jsdelivr.net/gh/USER/REPO@v1.0.0/widget.js`
4. **Update overal tegelijk:** door een nieuwe tag te pushen en de CDN-URL bij te werken

---

## 4. Firestore-structuur

Collectie: `tickets`

| Veld | Type | Waarde |
|------|------|--------|
| `board_id` | string | ID van het Kanban-bord |
| `status_id` | string | ID van de "Nieuw"-kolom |
| `type` | string | `bug` / `improvement` / `feature` |
| `title` | string | `[Bug] Eerste zin van omschrijving…` |
| `description` | string | Volledige omschrijving |
| `reporter.name` | string | Naam van de melder |
| `reporter.email` | string | E-mail van de melder |
| `metadata.source_site` | string | Naam van de externe website |
| `metadata.url` | string | Exacte pagina-URL |
| `metadata.browser_os` | string | User-Agent string |
| `metadata.resolution` | string | bijv. `1920x1080` |
| `attachment_url` | string / null | Firebase Storage URL |
| `created_at` | timestamp | Server-tijdstempel |

---

## 5. Veiligheids-checklist

- [ ] Elke externe website krijgt een **unieke** `apiKey`
- [ ] `VALID_API_KEYS` en `serviceAccountKey.json` staan **niet** in Git (voeg toe aan `.gitignore`)
- [ ] Firebase Storage-regels beperken schrijven tot de Admin SDK
- [ ] Overweeg rate-limiting toe te voegen (bijv. `express-rate-limit`) per API-sleutel
