# Feedback Widget — Implementatiegids

De widget is een klein stukje JavaScript dat je op eender welke website plakt.
Bezoekers kunnen er bugs, verbeteringen of feature-aanvragen mee insturen.
Die komen automatisch als kaartjes terecht in jouw Kanban-bord.

---

## Hoe werkt het in grote lijnen?

```
Bezoeker vult formulier in
        ↓
widget.js (via CDN)
        ↓
Firebase Cloud Function  ←  valideert API-sleutel
        ↓
Firestore (Kanban-bord)  →  nieuw kaartje verschijnt
```

Het script (`widget.js`) staat op GitHub en wordt automatisch geleverd via jsDelivr CDN.
Je hoeft maar op één plek iets aan te passen — de rest volgt vanzelf.

---

## Stap 1 — Nieuwe website toevoegen aan de tag-mapping

Open `widget.js` en zoek het `SITE_TAGS`-object bovenaan het bestand:

```js
const SITE_TAGS = {
  'localhost':       'TEST_TAG_ID',
  // 'website-a.be': 'TAG_ID_WEBSITE_A',
  // 'website-b.be': 'TAG_ID_WEBSITE_B',
};
```

Voeg één regel toe voor je nieuwe website:

```js
'mijnwebsite.be': 'FIRESTORE_TAG_ID_VAN_DIE_WEBSITE',
```

**Regels:**
- Domeinnaam altijd **zonder `www.`** en **zonder `https://`**
- Het tag-ID vind je in je Kanban-app (Firestore-ID van de tag die je wilt koppelen)
- `localhost` gebruik je enkel voor lokaal testen — verander de waarde naar een echt tag-ID als je wil dat testinzendingen ook getagd worden

Sla op, commit en push naar `main`. De GitHub Actions-workflow deploy automatisch en de CDN serveert de nieuwe versie.

---

## Stap 2 — Script op de website plakken

Plak dit snippet in de `<head>` van elke pagina, **voor** de sluit-tag `</head>`:

```html
<script>
  window.FeedbackWidgetConfig = {
    apiUrl:    "https://europe-west1-feedback-widget-f0087.cloudfunctions.net/feedbackApi",
    apiKey:    "kanban-2024-xK9p",
    boardId:   "XOhvgrJn3VYr7mR6vjsG",
    statusId:  "NouTYAysQ5KsQkqGWXRx",
    ownerUid:  "KNjbJuZV1MZMEUQKsViehVhW3832"
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/daneelsjo/feedback-widget@main/widget.js" defer></script>
```

Dit is **hetzelfde snippet op elke website** — je hoeft niets aan te passen per site.
De widget detecteert zelf op welk domein hij draait en pikt het juiste tag-ID op uit `SITE_TAGS`.

---

## Wat ziet de bezoeker?

Een paarse knop rechtsonder met "Feedback". Bij klikken opent een formulier:

| Veld | Verplicht | Omschrijving |
|------|-----------|--------------|
| Type | ja | Bug / Verbetering / Feature |
| Onderwerp | ja | Korte omschrijving (wordt de kaarttitel) |
| Naam | ja | Naam van de melder |
| E-mailadres | ja | E-mail van de melder |
| Omschrijving | ja | Uitgebreide beschrijving |

Na verzenden verschijnt een bevestigingsscherm. Het kaartje staat meteen in Kanban.

---

## Wat staat er op het kaartje in Kanban?

**Titel:** `[Bug] Onderwerp dat de bezoeker intikte`
(of `[Verbetering]` / `[Feature]` afhankelijk van het type)

**Beschrijving:**
```
Omschrijving die de bezoeker schreef

---
Gemeld door: Naam <email@voorbeeld.be>
Website: mijnwebsite.be
Pagina: https://mijnwebsite.be/contact
Browser: Mozilla/5.0 ...
Scherm: 1920x1080
```

**Tags op het kaartje:** type-tag + site-tag (als het domein in `SITE_TAGS` staat)

---

## Een nieuwe website toevoegen — samenvatting

1. Open `widget.js`
2. Voeg toe aan `SITE_TAGS`: `'nieuwdomein.be': 'FIRESTORE_TAG_ID'`
3. Commit & push naar `main`
4. Plak het vaste snippet (zie Stap 2) in de `<head>` van die website
5. Klaar — kaartjes komen automatisch getagd binnen

---

## Probleemoplossing

**Widget verschijnt niet**
→ Controleer of `window.FeedbackWidgetConfig` correct is ingesteld vóór het script-tag.
→ Open de browserconsole (F12) — er staat een waarschuwing als de config ontbreekt.

**Formulier geeft foutmelding**
→ Controleer of de Cloud Function actief is: [Firebase Console](https://console.firebase.google.com/project/feedback-widget-f0087/functions)
→ Bekijk de logboeken in de Firebase Console voor de exacte foutmelding.

**Kaartje verschijnt niet in Kanban**
→ Controleer of `ownerUid` in het snippet overeenkomt met jouw Firebase Auth UID.
→ Zoek in Firestore (collectie `workflowCards`) of het kaartje er wel staat maar met een ander UID.

**Tag-ID niet correct**
→ Controleer het `SITE_TAGS`-object in `widget.js` — domeinnaam zonder `www.` en zonder `https://`.
→ Verifieer het tag-ID in Firestore van je Kanban-project.

**CDN laadt oude versie**
→ jsDelivr cachet bestanden. Forceer verversing via: `https://purge.jsdelivr.net/gh/daneelsjo/feedback-widget@main/widget.js`
