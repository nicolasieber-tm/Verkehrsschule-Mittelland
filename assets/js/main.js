/* Verkehrsschule Mittelland — gemeinsames Seiten-JS
   - Initialisiert Lucide-Icons
   - Reveal-on-Scroll via IntersectionObserver
   - Mobile-Menü Toggle */

/* Calendly: Widget wird deferred geladen (nach window.load / requestIdleCallback),
   damit es zur Klickzeit synchron verfügbar ist (sonst stuft der Browser den Popup
   als "non-user-initiated" ein und öffnet ihn als neuen Tab statt Overlay).
   Hover/Focus auf einen Calendly-Button löst ebenfalls den Preload aus. */
(function () {
  let loaded = false;
  let loading = null;
  function loadCalendly() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://assets.calendly.com/assets/external/widget.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://assets.calendly.com/assets/external/widget.js';
      script.async = true;
      script.onload = function () { loaded = true; resolve(); };
      document.head.appendChild(script);
    });
    return loading;
  }
  window.openCalendly = function (url) {
    if (window.Calendly) {
      Calendly.initPopupWidget({ url: url });
    } else {
      loadCalendly().then(function () {
        if (window.Calendly) Calendly.initPopupWidget({ url: url });
      });
    }
    return false;
  };
  // Preload-Trigger: Idle-Zeit nach Page-Load oder bei Hover/Focus auf Calendly-Button
  function schedulePreload() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadCalendly, { timeout: 3000 });
    } else {
      setTimeout(loadCalendly, 1500);
    }
  }
  if (document.readyState === 'complete') schedulePreload();
  else window.addEventListener('load', schedulePreload);
  // Frühes Warm-up bei Interaktion (Hover/Focus auf Calendly-Buttons)
  document.addEventListener('mouseover', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[onclick*="openCalendly"]');
    if (a) loadCalendly();
  }, { passive: true });
  document.addEventListener('focusin', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[onclick*="openCalendly"]');
    if (a) loadCalendly();
  });
})();

(function () {
  const MOBILE_GROUPS = [
    {
      label: 'Standorte',
      icon: 'map-pin',
      links: [
        ['/fahrschule-solothurn', 'Kanton Solothurn'],
        ['/fahrschule-aargau', 'Kanton Aargau'],
        ['/fahrschule-baselland', 'Kanton Basel-Land'],
        ['/fahrschule-basel', 'Kanton Basel-Stadt'],
        ['/fahrschule-bern', 'Kanton Bern'],
        ['/fahrschule-luzern', 'Kanton Luzern'],
        ['/fahrschule-trimbach', 'Hauptstandort Trimbach'],
      ],
    },
    {
      label: 'Kurse',
      icon: 'graduation-cap',
      links: [
        ['/vku-olten', 'VKU'],
        ['/nothelferkurs-olten', 'Nothelferkurs'],
      ],
    },
    {
      label: 'Weiteres',
      icon: 'layers',
      links: [
        ['/wab', 'WAB-Kurs'],
        ['/anhanger', 'Anhänger (BE)'],
        ['/kontrollfahrt', 'Kontrollfahrt'],
        ['/taxi-bpt', 'Taxi BPT'],
        ['/gutscheine', 'Gutscheine'],
        ['/starterbox', 'Starter-Box'],
        ['/wissen', 'Wissen'],
        ['/jobs', 'Jobs'],
        ['/partner', 'Partner werden'],
        ['/nachfolge', 'Nachfolgelösung'],
      ],
    },
    {
      label: 'Über VSM',
      icon: 'info',
      links: [
        ['/#angebote', 'Angebote'],
        ['/#preise', 'Preise'],
        ['/#weg', 'Dein Weg'],
        ['/#ueber', 'Über uns'],
      ],
    },
  ];

  function rebuildMobileMenu(menu) {
    const container = document.createElement('div');
    container.className = 'px-4 sm:px-6 py-4 space-y-2';

    MOBILE_GROUPS.forEach(function (group) {
      const wrap = document.createElement('div');
      wrap.className = 'rounded-xl overflow-hidden';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-group-toggle w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-ink-900 font-semibold hover:bg-ink-50 transition';
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML =
        '<span class="flex items-center gap-3">' +
          '<i data-lucide="' + group.icon + '" class="w-5 h-5 text-brand-500"></i>' +
          '<span>' + group.label + '</span>' +
        '</span>' +
        '<i data-lucide="chevron-down" class="w-5 h-5 text-ink-500 transition-transform"></i>';

      const panel = document.createElement('div');
      panel.className = 'hidden pl-3 pr-1 pb-2 pt-1 space-y-1';
      group.links.forEach(function (l) {
        const a = document.createElement('a');
        a.href = l[0];
        a.className = 'mobile-link flex items-center justify-between px-4 py-2.5 rounded-xl text-ink-700 hover:bg-ink-50';
        a.innerHTML = '<span>' + l[1] + '</span><i data-lucide="chevron-right" class="w-4 h-4 text-ink-400"></i>';
        panel.appendChild(a);
      });

      btn.addEventListener('click', function () {
        const open = !panel.classList.contains('hidden');
        if (open) {
          panel.classList.add('hidden');
          btn.setAttribute('aria-expanded', 'false');
          const chev = btn.querySelector('[data-lucide="chevron-down"], svg.lucide-chevron-down');
          if (chev) chev.style.transform = '';
        } else {
          panel.classList.remove('hidden');
          btn.setAttribute('aria-expanded', 'true');
          const chev = btn.querySelector('[data-lucide="chevron-down"], svg.lucide-chevron-down');
          if (chev) chev.style.transform = 'rotate(180deg)';
        }
      });

      wrap.appendChild(btn);
      wrap.appendChild(panel);
      container.appendChild(wrap);
    });

    // Action-Buttons (Anrufen, WhatsApp, Jetzt buchen)
    const actions = document.createElement('div');
    actions.className = 'pt-3 mt-2 border-t border-ink-100 space-y-2';
    actions.innerHTML =
      '<div class="grid grid-cols-2 gap-2">' +
        '<a href="tel:+41791361616" class="mobile-link flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-ink-200 text-ink-700 font-semibold"><i data-lucide="phone" class="w-4 h-4"></i>Anrufen</a>' +
        '<a href="https://wa.me/41791361616" target="_blank" rel="noopener" class="mobile-link flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-ink-200 text-ink-700 font-semibold"><i data-lucide="message-circle" class="w-4 h-4"></i>WhatsApp</a>' +
      '</div>' +
      '<a href="/#preise" class="mobile-link block text-center px-4 py-3 rounded-xl bg-brand-500 text-white font-bold">Jetzt buchen</a>';
    container.appendChild(actions);

    menu.innerHTML = '';
    menu.appendChild(container);

    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
  }

  function init() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }

    // Reveal-on-Scroll
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });
    } else {
      document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    }

    // Mobile-Menü
    const btn = document.getElementById('mobileMenuBtn');
    const menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;

    // Menu in 4 ausklappbare Gruppen umbauen (Standorte / VKU / Nothelferkurs / Weiteres)
    rebuildMobileMenu(menu);

    function setIcon(name) {
      // Lucide ersetzt <i data-lucide> einmalig durch <svg>; daher bei jedem
      // Toggle ein frisches Placeholder-<i> einsetzen und neu rendern.
      btn.innerHTML = '<i data-lucide="' + name + '" class="w-5 h-5"></i>';
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    }
    function closeMenu() {
      menu.classList.add('hidden');
      setIcon('menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Menü öffnen');
      document.body.classList.remove('menu-open');
    }
    function openMenu() {
      menu.classList.remove('hidden');
      setIcon('x');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Menü schliessen');
      document.body.classList.add('menu-open');
    }

    btn.setAttribute('aria-controls', 'mobileMenu');
    btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('hidden')) openMenu(); else closeMenu();
    });
    document.querySelectorAll('.mobile-link').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.classList.contains('hidden')) closeMenu();
    });
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1024) closeMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
