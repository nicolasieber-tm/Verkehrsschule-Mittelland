// Anmeldeformular für Nothelferkurs
// Liest ?kurs-id=… aus URL, lädt Kursdaten, rendert Form, postet an Backend.

(function () {
  const API_BASE = window.VSM_API || (window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://api.verkehrsschule-mittelland.ch');

  const params = new URLSearchParams(window.location.search);
  const kursId = parseInt(params.get('kurs-id'), 10);

  const courseBox = document.getElementById('course-info');
  const formBox = document.getElementById('form-box');
  const successBox = document.getElementById('success-box');

  if (!courseBox || !formBox) return;

  // Mark form-load timestamp for time-trap
  const loadedAt = Date.now();

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function formatDateOnly(iso) {
    return new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' });
  }

  function renderCourse(c) {
    courseBox.replaceChildren();
    const variant = c.variant === 'classic' ? 'Klassischer Nothelferkurs' : 'eNothelferkurs';
    courseBox.append(el('h2', 'font-display font-extrabold text-2xl mb-2', variant));
    courseBox.append(el('p', 'text-ink-500 mb-4', `Kursnr. ${c.course_no} · ${c.location}`));

    const list = el('ul', 'space-y-2 mb-4 text-ink-700');
    (c.sessions || []).forEach((s) => {
      list.append(el('li', '', `${s.day} ${formatDateOnly(s.date)}  ${s.from}–${s.to}`));
    });
    courseBox.append(list);

    const price = el('p', 'text-lg', '');
    price.append(el('strong', '', `CHF ${c.price_chf}.–`));
    price.append(document.createTextNode(c.variant === 'classic' ? ' (inkl. Nothilfeausweis)' : ' (+ eLearning CHF 15)'));
    courseBox.append(price);

    const hint = el('div', 'mt-4 p-4 bg-amber-50 border-l-4 border-amber-400 text-amber-900 rounded');
    hint.append(el('strong', '', 'Bitte beachten: '));
    hint.append(document.createTextNode('Die Kursgebühr ist am ersten Kurstag vor Kursbeginn in BAR oder per TWINT zu bezahlen.'));
    courseBox.append(hint);
  }

  function renderError(msg) {
    courseBox.replaceChildren();
    courseBox.append(el('div', 'p-4 bg-red-50 text-red-800 rounded', msg));
    formBox.style.display = 'none';
  }

  if (!Number.isInteger(kursId) || kursId <= 0) {
    renderError('Ungültige Kurs-ID. Bitte wähle einen Kurs aus der Kursliste.');
    return;
  }

  // Load course
  fetch(`${API_BASE}/api/courses/${kursId}`, { credentials: 'omit' })
    .then((r) => {
      if (r.status === 404) throw new Error('not_bookable');
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then((data) => {
      renderCourse(data.course);
      // Stamp hidden timestamp + kurs-id in form
      document.getElementById('field-course-id').value = String(data.course.id);
      document.getElementById('field-ts').value = String(loadedAt);
    })
    .catch((err) => {
      if (err.message === 'not_bookable') {
        renderError('Dieser Kurs ist nicht (mehr) buchbar. Bitte wähle einen anderen Kurs.');
      } else {
        renderError('Kursdaten konnten nicht geladen werden. Bitte später erneut versuchen.');
      }
    });

  // Handle form submit
  const form = document.getElementById('anmeldung-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    const errBox = document.getElementById('form-error');
    errBox.style.display = 'none';
    errBox.replaceChildren();
    submitBtn.disabled = true;
    submitBtn.dataset.origLabel = submitBtn.dataset.origLabel || submitBtn.textContent;
    submitBtn.textContent = 'Wird gesendet…';

    const fd = new FormData(form);
    const body = new URLSearchParams();
    for (const [k, v] of fd.entries()) body.append(k, v);

    try {
      const resp = await fetch(`${API_BASE}/api/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'omit',
        body: body.toString(),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        formBox.style.display = 'none';
        successBox.style.display = '';
        successBox.replaceChildren(
          el('h2', 'font-display font-extrabold text-2xl mb-4 text-green-700', 'Anmeldung bestätigt!'),
          el('p', 'mb-3', `Vielen Dank! Deine Anmeldung für Kurs ${data.courseNo} ist eingegangen.`),
          el('p', 'mb-3', 'Du erhältst in Kürze eine Bestätigungsmail. Falls keine ankommt, schau in den Spam-Ordner oder schreib uns auf WhatsApp.'),
          el('p', 'p-4 bg-amber-50 border-l-4 border-amber-400 text-amber-900 rounded',
             'Bitte beachten: Die Kursgebühr ist am ersten Kurstag vor Kursbeginn in BAR oder per TWINT zu bezahlen.'),
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      // Errors
      let msg = 'Anmeldung fehlgeschlagen.';
      if (data.message) msg = data.message;
      else if (data.error === 'sold_out') msg = 'Der Kurs ist leider ausgebucht.';
      else if (data.error === 'duplicate') msg = 'Du bist für diesen Kurs bereits angemeldet.';
      else if (data.error === 'closed') msg = 'Dieser Kurs ist nicht mehr buchbar.';
      else if (data.error === 'deadline_passed') msg = 'Die Anmeldefrist ist abgelaufen.';
      else if (data.error === 'consent_required') msg = 'Bitte beide Bestätigungen ankreuzen.';
      else if (data.error === 'invalid_input') msg = 'Bitte alle Felder korrekt ausfüllen.';
      errBox.textContent = msg;
      errBox.style.display = '';
    } catch (err) {
      errBox.textContent = 'Anmeldung konnte nicht gesendet werden. Bitte später erneut versuchen.';
      errBox.style.display = '';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.origLabel;
    }
  });
})();
