// Google Reviews Carousel — fetches reviews from backend and renders an auto-scrolling carousel
(function () {
  const API_BASE = window.VSM_API || (
    window.location.hostname === 'localhost' ? 'http://localhost:3000' :
    window.location.hostname.endsWith('.up.railway.app') ? 'https://backend-production-dc0c4.up.railway.app' :
    'https://api.verkehrsschule-mittelland.ch'
  );

  const container = document.getElementById('google-reviews');
  if (!container) return;

  const PLACE_URL = 'https://www.google.com/maps/place/Verkehrsschule+Mittelland/@47.3606711,7.899912,17z/data=!3m1!4b1!4m6!3m5!1s0x404aa30ff12eaa5b:0xce7c697b56c3c658';
  const WRITE_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJW6ou8Q-jSkARWMbDVntpfM4';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatRelativeTime(unixSeconds) {
    const now = Date.now() / 1000;
    const diff = now - unixSeconds;
    const days = Math.floor(diff / 86400);
    if (days < 7) return 'in der letzten Woche';
    if (days < 14) return 'vor 1 Woche';
    if (days < 30) return `vor ${Math.floor(days / 7)} Wochen`;
    if (days < 60) return 'vor 1 Monat';
    if (days < 365) return `vor ${Math.floor(days / 30)} Monaten`;
    if (days < 730) return 'vor 1 Jahr';
    return `vor ${Math.floor(days / 365)} Jahren`;
  }

  function stars(rating) {
    const full = Math.round(rating);
    let s = '';
    for (let i = 0; i < 5; i++) {
      s += `<svg class="w-4 h-4 inline-block ${i < full ? 'text-amber-400 fill-amber-400' : 'text-ink-200 fill-ink-200'}" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    }
    return s;
  }

  function googleIcon() {
    return `<svg viewBox="0 0 24 24" class="w-5 h-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;
  }

  function renderHeader(data) {
    return `
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 pb-6 border-b border-ink-100">
        <div class="flex items-center gap-4">
          ${googleIcon()}
          <div>
            <div class="flex items-center gap-2">
              <span class="font-display font-extrabold text-2xl text-ink-900">${data.rating.toFixed(1)}</span>
              <div class="flex">${stars(data.rating)}</div>
            </div>
            <p class="text-sm text-ink-500 mt-0.5">${data.total} Bewertungen bei Google</p>
          </div>
        </div>
        <a href="${WRITE_REVIEW_URL}" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 text-white font-bold text-sm hover:bg-brand-600 transition">
          Bewerten Sie uns auf Google
        </a>
      </div>
    `;
  }

  function renderCard(r) {
    const initial = (r.author_name || '?').trim().charAt(0).toUpperCase();
    const avatar = r.profile_photo_url
      ? `<img src="${escapeHtml(r.profile_photo_url)}" alt="${escapeHtml(r.author_name)}" loading="lazy" class="w-12 h-12 rounded-full object-cover" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'w-12 h-12 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-lg',textContent:'${initial}'}))" />`
      : `<div class="w-12 h-12 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-lg">${initial}</div>`;

    return `
      <article class="snap-start flex-shrink-0 w-[300px] sm:w-[340px] bg-white border border-ink-100 rounded-3xl p-6 shadow-sm flex flex-col">
        <header class="flex items-start gap-3 mb-3">
          <div class="relative">
            ${avatar}
            <div class="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">${googleIcon()}</div>
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="font-bold text-ink-900 truncate">${escapeHtml(r.author_name)}</h3>
            <p class="text-xs text-ink-500">${formatRelativeTime(r.time)}</p>
          </div>
        </header>
        <div class="flex gap-0.5 mb-3">${stars(r.rating)}</div>
        <p class="text-sm text-ink-700 leading-relaxed line-clamp-6">${escapeHtml(r.text)}</p>
      </article>
    `;
  }

  function render(data) {
    const reviews = (data.reviews || []).slice().sort((a, b) => b.time - a.time);
    if (reviews.length === 0) {
      container.innerHTML = `<p class="text-center text-ink-500">Keine Bewertungen verfügbar.</p>`;
      return;
    }

    container.innerHTML = `
      ${renderHeader(data)}
      <div class="relative">
        <div id="reviews-scroller" class="flex gap-5 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 scroll-smooth" style="scrollbar-width: thin;">
          ${reviews.map(renderCard).join('')}
        </div>
        <div class="flex justify-center gap-3 mt-6">
          <button type="button" id="reviews-prev" aria-label="Vorherige Bewertung" class="w-10 h-10 rounded-full border border-ink-200 bg-white hover:bg-ink-50 transition flex items-center justify-center">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button type="button" id="reviews-next" aria-label="Nächste Bewertung" class="w-10 h-10 rounded-full border border-ink-200 bg-white hover:bg-ink-50 transition flex items-center justify-center">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    `;

    const scroller = document.getElementById('reviews-scroller');
    const cardWidth = () => {
      const card = scroller.querySelector('article');
      return card ? card.offsetWidth + 20 : 320;
    };
    document.getElementById('reviews-prev').addEventListener('click', () => {
      scroller.scrollBy({ left: -cardWidth(), behavior: 'smooth' });
    });
    document.getElementById('reviews-next').addEventListener('click', () => {
      scroller.scrollBy({ left: cardWidth(), behavior: 'smooth' });
    });
  }

  fetch(API_BASE + '/api/reviews', { credentials: 'omit' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(render)
    .catch((err) => {
      console.error('Failed to load reviews:', err);
      container.innerHTML = `
        <div class="text-center py-8">
          <p class="text-ink-500 mb-4">Bewertungen konnten nicht geladen werden.</p>
          <a href="${PLACE_URL}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-brand-500 hover:text-brand-600 font-semibold">
            Bewertungen auf Google ansehen →
          </a>
        </div>
      `;
    });
})();
