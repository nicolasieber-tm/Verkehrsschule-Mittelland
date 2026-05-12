// Anfrage 10er Fahrstunden-Paket
// Liest ?vku=0|1 aus URL, rendert Summary, postet multipart an Backend.

(function () {
  const API_BASE = window.VSM_API || (
    window.location.hostname === 'localhost' ? 'http://localhost:3000' :
    window.location.hostname.endsWith('.up.railway.app') ? 'https://backend-production-dc0c4.up.railway.app' :
    'https://api.verkehrsschule-mittelland.ch'
  );

  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

  const loadedAt = Date.now();

  const params = new URLSearchParams(window.location.search);
  let vku = params.get('vku') === '1';

  const formBox = document.getElementById('form-box');
  const successBox = document.getElementById('success-box');
  const summaryTitle = document.getElementById('summary-title');
  const summarySub = document.getElementById('summary-sub');
  const summaryPrice = document.getElementById('summary-price');
  const summaryStrike = document.getElementById('summary-strike');
  const fieldVku = document.getElementById('field-vku');
  const tsField = document.getElementById('field-ts');
  const fileInput = document.getElementById('lernfahrausweis');
  const fileFeedback = document.getElementById('file-feedback');
  const vkuToggle = document.querySelector('[data-option-vku]');

  tsField.value = String(loadedAt);

  function renderSummary() {
    fieldVku.value = vku ? '1' : '0';
    if (vku) {
      summaryTitle.textContent = '10er-Paket + VKU-Kurs';
      summarySub.textContent = '10 Fahrlektionen à 45 Min · inkl. VKU-Kurs';
      summaryPrice.textContent = 'CHF 1050';
      summaryStrike.textContent = 'statt CHF 1140';
    } else {
      summaryTitle.textContent = '10er-Paket';
      summarySub.textContent = '10 Fahrlektionen à 45 Min';
      summaryPrice.textContent = 'CHF 900';
      summaryStrike.textContent = 'statt CHF 950';
    }
    if (vkuToggle) vkuToggle.checked = vku;
  }

  vkuToggle?.addEventListener('change', (e) => {
    vku = e.target.checked;
    renderSummary();
  });

  renderSummary();

  // File feedback
  fileInput?.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      fileFeedback.classList.add('hidden');
      return;
    }
    const sizeMb = (f.size / 1024 / 1024).toFixed(2);
    if (!ALLOWED_MIME.includes(f.type)) {
      fileFeedback.textContent = `Format nicht erlaubt (${f.type || 'unbekannt'}). Erlaubt: PDF, JPG, PNG.`;
      fileFeedback.className = 'mt-2 text-xs text-red-600';
      fileInput.value = '';
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      fileFeedback.textContent = `Datei zu gross (${sizeMb} MB). Maximum: 5 MB.`;
      fileFeedback.className = 'mt-2 text-xs text-red-600';
      fileInput.value = '';
      return;
    }
    fileFeedback.textContent = `${f.name} · ${sizeMb} MB`;
    fileFeedback.className = 'mt-2 text-xs text-ink-600';
  });

  // Submit
  const form = document.getElementById('anfrage-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    const errBox = document.getElementById('form-error');
    errBox.style.display = 'none';
    errBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.dataset.origLabel = submitBtn.dataset.origLabel || submitBtn.textContent;
    submitBtn.textContent = 'Wird gesendet…';

    try {
      const fd = new FormData(form);
      const fEl = fd.get('lernfahrausweis');
      if (fEl instanceof File && fEl.size === 0) fd.delete('lernfahrausweis');

      const resp = await fetch(`${API_BASE}/api/package-requests`, {
        method: 'POST',
        credentials: 'omit',
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        formBox.style.display = 'none';
        successBox.style.display = '';
        successBox.innerHTML = `
          <h2 class="font-display font-extrabold text-2xl mb-4 text-green-700">Anfrage gesendet!</h2>
          <p class="mb-3">Danke für deine Anfrage. Wir melden uns innerhalb von 24 Stunden mit den nächsten Schritten.</p>
          <p class="mb-3">Du erhältst gleich eine Bestätigungsmail. Falls keine ankommt, schau bitte im Spam-Ordner.</p>
          <a href="/" class="inline-block mt-2 px-6 py-3 rounded-full bg-brand-500 text-white font-bold hover:bg-brand-600 transition">Zur Startseite</a>
        `;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      let msg = 'Anfrage konnte nicht gesendet werden.';
      if (data.message) msg = data.message;
      else if (data.error === 'consent_required') msg = 'Bitte beide Bestätigungen ankreuzen.';
      else if (data.error === 'invalid_input') msg = 'Bitte alle Felder korrekt ausfüllen.';
      else if (data.error === 'file_too_large') msg = 'Die hochgeladene Datei ist zu gross (max. 5 MB).';
      else if (data.error === 'invalid_file_type') msg = 'Dateiformat nicht unterstützt. Bitte PDF, JPG oder PNG.';
      errBox.textContent = msg;
      errBox.style.display = '';
    } catch (err) {
      errBox.textContent = 'Anfrage konnte nicht gesendet werden. Bitte später erneut versuchen.';
      errBox.style.display = '';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.origLabel;
    }
  });
})();
