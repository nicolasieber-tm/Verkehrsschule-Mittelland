// Gutschein-Bestellformular
// Validiert + sendet JSON an POST /api/voucher-orders

(function () {
  const API_BASE = window.VSM_API || (
    window.location.hostname === 'localhost' ? 'http://localhost:3000' :
    window.location.hostname.endsWith('.up.railway.app') ? 'https://backend-production-dc0c4.up.railway.app' :
    'https://api.verkehrsschule-mittelland.ch'
  );

  const loadedAt = Date.now();
  const form = document.getElementById('gutschein-form');
  if (!form) return;

  const tsField = document.getElementById('field-ts');
  if (tsField) tsField.value = String(loadedAt);

  const lieferToggle = document.getElementById('liefer-toggle');
  const lieferFields = document.getElementById('liefer-fields');
  lieferToggle?.addEventListener('change', () => {
    if (lieferToggle.checked) lieferFields.classList.remove('hidden');
    else lieferFields.classList.add('hidden');
  });

  const errBox = document.getElementById('form-error');
  const successBox = document.getElementById('success-box');

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = '';
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function getBetrag(fd) {
    // Freier Betrag hat Vorrang, wenn ausgefüllt
    const frei = String(fd.get('betrag_frei') || '').trim().replace(/[^\d]/g, '');
    if (frei) return parseInt(frei, 10);
    const radio = fd.get('betrag');
    return radio ? parseInt(radio, 10) : NaN;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    errBox.textContent = '';

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.dataset.origLabel = submitBtn.dataset.origLabel || submitBtn.innerHTML;

    const fd = new FormData(form);
    const betrag_chf = getBetrag(fd);
    if (!Number.isInteger(betrag_chf) || betrag_chf < 1 || betrag_chf > 100000) {
      showError('Bitte einen gültigen Betrag wählen oder eintragen.');
      return;
    }

    const useSeparateShipping = lieferToggle?.checked;
    const payload = {
      betrag_chf,
      fuer: String(fd.get('fuer') || '').trim(),
      von: String(fd.get('von') || '').trim(),
      lvname: useSeparateShipping ? String(fd.get('lvname') || '').trim() : '',
      lnname: useSeparateShipping ? String(fd.get('lnname') || '').trim() : '',
      lstrasse: useSeparateShipping ? String(fd.get('lstrasse') || '').trim() : '',
      lhnr: useSeparateShipping ? String(fd.get('lhnr') || '').trim() : '',
      lplz: useSeparateShipping ? String(fd.get('lplz') || '').trim() : '',
      lort: useSeparateShipping ? String(fd.get('lort') || '').trim() : '',
      rvname: String(fd.get('rvname') || '').trim(),
      rnname: String(fd.get('rnname') || '').trim(),
      rstrasse: String(fd.get('rstrasse') || '').trim(),
      rhnr: String(fd.get('rhnr') || '').trim(),
      rplz: String(fd.get('rplz') || '').trim(),
      rort: String(fd.get('rort') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      telefon: String(fd.get('telefon') || '').trim(),
      consent_privacy: fd.get('consent_privacy') === 'on',
      consent_terms: fd.get('consent_terms') === 'on',
      website: String(fd.get('website') || ''),
      ts: loadedAt,
    };

    if (!payload.consent_privacy || !payload.consent_terms) {
      showError('Bitte Datenschutz und AGB bestätigen.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird gesendet…';

    try {
      const resp = await fetch(`${API_BASE}/api/voucher-orders`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        form.style.display = 'none';
        successBox.style.display = '';
        successBox.innerHTML = `
          <h2 class="font-display font-extrabold text-2xl mb-4 text-green-700">Bestellung erhalten!</h2>
          <p class="mb-3">Vielen Dank für deine Gutschein-Bestellung. Wir verschicken den Gutschein in den nächsten Tagen per Post.</p>
          <p class="mb-3">Du erhältst gleich eine Bestätigungsmail. Die Rechnung folgt separat per E-Mail. Falls keine Mail ankommt, schau bitte im Spam-Ordner.</p>
          <a href="/" class="inline-block mt-2 px-6 py-3 rounded-full bg-brand-500 text-white font-bold hover:bg-brand-600 transition">Zur Startseite</a>
        `;
        // Warte einen Frame, damit das Layout nach form.display=none stabil ist,
        // sonst scrollt der Browser auf Basis der alten Position zu weit.
        requestAnimationFrame(() => {
          successBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }

      let msg = 'Bestellung konnte nicht gesendet werden.';
      if (data.message) msg = data.message;
      else if (data.error === 'consent_required') msg = 'Bitte beide Bestätigungen ankreuzen.';
      else if (data.error === 'invalid_input') msg = 'Bitte alle Pflichtfelder korrekt ausfüllen.';
      showError(msg);
    } catch {
      showError('Bestellung konnte nicht gesendet werden. Bitte später erneut versuchen.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.origLabel;
    }
  });
})();
