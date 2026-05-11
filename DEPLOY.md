# Railway-Deployment

Zwei Services: Frontend (Static) und Backend (Node + Postgres).

## Voraussetzungen

- Railway-Account: https://railway.app/
- Domain unter Kontrolle (verkehrsschule-mittelland.ch)
- Resend-Account: https://resend.com/

## 1. Backend-Service (Fastify + Postgres)

### 1a. Postgres-DB anlegen
- Railway-Dashboard → **New Project** → **Provision Postgres**
- Backups in den Postgres-Settings aktivieren

### 1b. Backend-Service deployen
- Im selben Projekt: **+ New** → **GitHub Repo** (oder per CLI) → Repository auswählen
- **Root Directory** auf `backend` setzen
- Railway erkennt automatisch die `Dockerfile` (via `railway.json`)

### 1c. Environment-Variablen setzen
Im Backend-Service unter **Variables**:

| Variable | Wert |
|----------|------|
| `DATABASE_URL` | aus Postgres-Service referenzieren: `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | 32-byte Hex generieren: `openssl rand -hex 32` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `ALLOWED_ORIGINS` | `https://verkehrsschule-mittelland.ch,https://www.verkehrsschule-mittelland.ch` |
| `RESEND_API_KEY` | aus Resend-Dashboard → API Keys |
| `MAIL_FROM` | `anmeldung@verkehrsschule-mittelland.ch` (Domain muss in Resend verifiziert sein) |
| `MAIL_TO_SCHOOL` | E-Mail-Adresse der Schule |
| `TOTP_ISSUER` | `Verkehrsschule Mittelland` |
| `ADMIN_BASE_URL` | `https://api.verkehrsschule-mittelland.ch` (für Mail-Links zum Admin) |
| `ANONYMIZE_AFTER_DAYS` | `730` (oder gemäss interner Retention-Policy) |
| `IP_HASH_RETENTION_DAYS` | `30` |

### 1d. Custom Domain
- Backend-Service → **Settings** → **Networking** → **+ Custom Domain** → `api.verkehrsschule-mittelland.ch`
- CNAME-Record im DNS-Provider setzen wie angezeigt

### 1e. Admin-User anlegen
Im Railway-Service-Terminal (oder via `railway shell`):
```bash
ADMIN_EMAIL=admin@verkehrsschule-mittelland.ch ADMIN_PASSWORD='Starkes-Initialpasswort-123!' node src/scripts/create-admin.js
```
Beim ersten Login wird man zur Passwort-Änderung und 2FA-Setup gezwungen.

## 2. Frontend-Service (Static Site)

### 2a. Static-Site-Service anlegen
- Im selben Projekt: **+ New** → **GitHub Repo** → gleiche Repo
- **Root Directory** auf `/` (Projektroot) lassen
- Railway erkennt vermutlich kein automatisches Buildverfahren — daher manuell:
  - **Settings** → **Build** → **Builder**: `Nixpacks`
  - **Custom Build Command**: leer
  - **Custom Start Command**: `npx http-server -p $PORT --gzip -c-1 .` (oder `serve -l $PORT`)
  
Alternativ, falls einfacher: **Static Site Hosting** auf Railway nutzen oder die HTML-Dateien auf Cloudflare Pages / Netlify deployen.

### 2b. API-URL konfigurieren
Vor dem Deploy in jeder Seite das `VSM_API`-Global setzen, ODER die Default-Logik im JS funktioniert automatisch:
```js
window.VSM_API = window.VSM_API || (location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://api.verkehrsschule-mittelland.ch');
```
Das ist bereits so in `assets/js/kurse.js` und `assets/js/anmeldung.js` — keine Änderung nötig, sofern die Backend-Domain wie hier angenommen heisst.

### 2c. Custom Domain
- Static-Service → **Settings** → **Networking** → **+ Custom Domain** → `verkehrsschule-mittelland.ch`
- `www.verkehrsschule-mittelland.ch` ebenfalls hinzufügen oder DNS-CNAME zu apex

## 3. Resend Domain-Verifikation

- Resend-Dashboard → **Domains** → **+ Add Domain** → `verkehrsschule-mittelland.ch`
- Resend zeigt die nötigen DNS-Records: SPF (TXT), DKIM (CNAME), MX optional
- DNS-Records bei Domain-Provider eintragen
- Auf "Verified" warten (kann 15 min bis ein paar Stunden dauern)

## 4. DPAs / Verträge

- Railway: Auftragsbearbeitungsvertrag (Data Processing Agreement) abschliessen. Self-Service: https://railway.com/legal/dpa
- Resend: DPA abschliessen über das Dashboard / Account Settings

## 5. Testlauf nach Deploy

1. `https://api.verkehrsschule-mittelland.ch/health` → `{"ok":true}`
2. `https://verkehrsschule-mittelland.ch/nothelferkurs-olten.html` → Section "Verfügbare Kurse in Olten" lädt
3. Admin-Login auf `https://api.verkehrsschule-mittelland.ch/admin/login` → 2FA-Setup durchlaufen → Testkurs anlegen
4. Auf Frontend prüfen ob der Kurs erscheint → Test-Anmeldung absenden → beide Mails ankommen
5. Im Admin → Anmeldung sehen → "Bezahlt"-Marke testen → Storno testen → Plätze-Counter prüfen
