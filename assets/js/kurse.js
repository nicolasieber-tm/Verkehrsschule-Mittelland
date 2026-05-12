// Dynamic course list for nothelferkurs-{olten,trimbach}.html
// Renders into element with id="kurse-liste".
// Reads data-location attribute on that element to filter.

(function () {
  const API_BASE = window.VSM_API || (
    window.location.hostname === 'localhost' ? 'http://localhost:3000' :
    window.location.hostname.endsWith('.up.railway.app') ? 'https://backend-production-dc0c4.up.railway.app' :
    'https://api.verkehrsschule-mittelland.ch'
  );

  const container = document.getElementById('kurse-liste');
  if (!container) return;
  const filterLocation = container.dataset.location || '';

  const url = new URL(API_BASE + '/api/courses');
  if (filterLocation) url.searchParams.set('location', filterLocation);

  const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function parseSessionDate(s) {
    // Parse "YYYY-MM-DD" as local-tz date (no time component)
    const [y, m, d] = String(s.date).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatSessionDay(s) {
    const d = parseSessionDate(s);
    return {
      weekday: WEEKDAY_SHORT[d.getDay()],
      day: String(d.getDate()).padStart(2, '0'),
      month: MONTH_SHORT[d.getMonth()],
    };
  }

  function svgIcon(path, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (cls) svg.setAttribute('class', cls);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  function renderCourse(c) {
    const free = c.max_seats - c.booked_seats;
    const isFull = free <= 0;
    const variantLabel = c.variant === 'classic' ? 'Klassisch' : 'eNothelferkurs';
    const dayCount = (c.sessions || []).length;
    const daysLabel = dayCount === 1 ? '1 Tag' : `${dayCount} Tage`;
    const variantSub = c.variant === 'classic'
      ? `${daysLabel} vor Ort`
      : `3 h online + ${daysLabel} Praxis`;

    const card = document.createElement('article');
    card.className = [
      'bg-white text-ink-900 rounded-3xl overflow-hidden',
      'shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)]',
      'transition-all duration-300 hover:-translate-y-1',
      'flex flex-col',
    ].join(' ');

    // === Top bar: variant + price + plätze badge ===
    const topbar = document.createElement('div');
    topbar.className = 'flex items-start justify-between gap-4 px-6 pt-6 pb-4 sm:px-8';

    const topLeft = document.createElement('div');
    topLeft.className = 'min-w-0';
    const variantBadge = document.createElement('div');
    variantBadge.className = 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-bold uppercase tracking-wide mb-3';
    variantBadge.append(svgIcon('M22 12h-4l-3 9L9 3l-3 9H2', 'w-3.5 h-3.5'));
    variantBadge.append(document.createTextNode(variantLabel));
    topLeft.append(variantBadge);

    const courseNo = document.createElement('div');
    courseNo.className = 'font-display font-extrabold text-lg sm:text-xl truncate';
    courseNo.textContent = `Kurs Nr. ${c.course_no}`;
    topLeft.append(courseNo);

    const subline = document.createElement('div');
    subline.className = 'text-ink-500 text-sm mt-0.5';
    subline.textContent = variantSub;
    topLeft.append(subline);

    const topRight = document.createElement('div');
    topRight.className = 'flex flex-col items-end gap-2 flex-shrink-0';
    const priceWrap = document.createElement('div');
    priceWrap.className = 'text-right';
    const priceVal = document.createElement('div');
    priceVal.className = 'font-display font-extrabold text-2xl sm:text-3xl leading-none';
    priceVal.textContent = `CHF ${c.price_chf}.–`;
    const priceLbl = document.createElement('div');
    priceLbl.className = 'text-xs text-ink-500 mt-1';
    priceLbl.textContent = c.variant === 'classic' ? 'inkl. Ausweis' : 'zzgl. eLearning CHF 15';
    priceWrap.append(priceVal, priceLbl);

    const seatsBadge = document.createElement('div');
    seatsBadge.className = isFull
      ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold'
      : (free <= 3
          ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-bold');
    const dot = document.createElement('span');
    dot.className = isFull
      ? 'w-1.5 h-1.5 rounded-full bg-red-500'
      : (free <= 3 ? 'w-1.5 h-1.5 rounded-full bg-amber-500' : 'w-1.5 h-1.5 rounded-full bg-green-500');
    seatsBadge.append(dot);
    seatsBadge.append(document.createTextNode(isFull ? 'Ausgebucht' : `${free} Plätze frei`));

    topRight.append(priceWrap, seatsBadge);
    topbar.append(topLeft, topRight);
    card.append(topbar);

    // === Sessions block ===
    const sessionsWrap = document.createElement('div');
    sessionsWrap.className = 'px-6 sm:px-8 pb-2';
    const sessionsList = document.createElement('div');
    sessionsList.className = 'border-t border-ink-100 pt-4 grid gap-3';
    (c.sessions || []).forEach((s) => {
      const parts = formatSessionDay(s);
      const row = document.createElement('div');
      row.className = 'flex items-center gap-4';

      const datePill = document.createElement('div');
      datePill.className = 'flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-brand-50 text-brand-700 flex-shrink-0';
      const dayNum = document.createElement('div');
      dayNum.className = 'font-display font-extrabold text-xl leading-none';
      dayNum.textContent = parts.day;
      const monthLbl = document.createElement('div');
      monthLbl.className = 'text-[10px] uppercase font-bold tracking-wider mt-0.5';
      monthLbl.textContent = parts.month;
      datePill.append(dayNum, monthLbl);

      const sessionMeta = document.createElement('div');
      sessionMeta.className = 'min-w-0';
      const weekdayEl = document.createElement('div');
      weekdayEl.className = 'font-semibold text-ink-900';
      weekdayEl.textContent = `${parts.weekday} · ${parts.day}.${String(parseSessionDate(s).getMonth() + 1).padStart(2, '0')}.${parseSessionDate(s).getFullYear()}`;
      const timeEl = document.createElement('div');
      timeEl.className = 'text-sm text-ink-500';
      timeEl.append(svgIcon('M12 6v6l4 2 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'w-3.5 h-3.5 inline mr-1 -mt-0.5'));
      timeEl.append(document.createTextNode(`${s.from} – ${s.to} Uhr`));
      sessionMeta.append(weekdayEl, timeEl);

      row.append(datePill, sessionMeta);
      sessionsList.append(row);
    });
    sessionsWrap.append(sessionsList);
    card.append(sessionsWrap);

    // === Footer: location + CTA ===
    const footer = document.createElement('div');
    footer.className = 'mt-4 px-6 sm:px-8 pb-6 sm:pb-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-ink-100 pt-4';

    const locWrap = document.createElement('div');
    locWrap.className = 'flex items-center gap-2 text-sm text-ink-600 min-w-0';
    locWrap.append(svgIcon('M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'w-4 h-4 text-brand-500 flex-shrink-0'));
    const locText = document.createElement('span');
    locText.className = 'truncate';
    locText.textContent = c.location;
    locWrap.append(locText);

    const cta = document.createElement('a');
    if (isFull) {
      cta.className = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-ink-100 text-ink-500 font-bold text-sm cursor-not-allowed pointer-events-none whitespace-nowrap';
      cta.textContent = 'Ausgebucht';
    } else {
      cta.className = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-brand-500 text-white font-bold text-sm hover:bg-brand-600 transition whitespace-nowrap shadow-[0_4px_14px_rgba(39,159,245,0.4)]';
      cta.href = `/anmeldung-nothelferkurs?kurs-id=${encodeURIComponent(c.id)}`;
      cta.textContent = 'Jetzt anmelden';
      cta.append(svgIcon('M5 12h14 M12 5l7 7-7 7', 'w-4 h-4'));
    }

    footer.append(locWrap, cta);
    card.append(footer);

    return card;
  }

  function renderEmpty() {
    const wrap = document.createElement('div');
    wrap.className = 'bg-white/5 border border-white/10 rounded-3xl p-8 sm:p-10 text-center';
    const icon = svgIcon('M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'w-12 h-12 mx-auto mb-4 text-brand-400');
    wrap.append(icon);
    const h = document.createElement('h4');
    h.className = 'font-display font-extrabold text-xl mb-2 text-white';
    h.textContent = 'Aktuell keine offenen Termine';
    const p = document.createElement('p');
    p.className = 'text-ink-100/70 mb-6 text-sm sm:text-base';
    p.textContent = 'Schreib uns auf WhatsApp oder ruf an — wir tragen dich gerne in den nächsten passenden Kurs ein.';
    const links = document.createElement('div');
    links.className = 'flex flex-col sm:flex-row gap-3 justify-center';
    const wa = document.createElement('a');
    wa.href = 'https://wa.me/41791361616';
    wa.className = 'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-green-500 text-white font-bold hover:bg-green-600 transition';
    wa.textContent = 'WhatsApp';
    const tel = document.createElement('a');
    tel.href = 'tel:+41791361616';
    tel.className = 'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-white/40 text-white font-bold hover:bg-white/10 transition';
    tel.textContent = '+41 79 136 16 16';
    links.append(wa, tel);
    wrap.append(h, p, links);
    return wrap;
  }

  function renderError() {
    const el = document.createElement('div');
    el.className = 'bg-white/5 border border-white/10 rounded-3xl p-8 text-center text-white/80';
    el.textContent = 'Kurse können momentan nicht geladen werden. Bitte schreib uns auf WhatsApp.';
    return el;
  }

  fetch(url.toString(), { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
    .then((data) => {
      container.replaceChildren();
      if (!data.courses || data.courses.length === 0) {
        container.append(renderEmpty());
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'grid gap-5 sm:gap-6 max-w-3xl mx-auto';
      data.courses.forEach((c) => wrap.append(renderCourse(c)));
      container.append(wrap);
    })
    .catch(() => {
      container.replaceChildren(renderError());
    });
})();
