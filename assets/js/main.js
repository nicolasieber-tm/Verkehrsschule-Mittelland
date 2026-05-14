/* Verkehrsschule Mittelland — gemeinsames Seiten-JS
   - Initialisiert Lucide-Icons
   - Reveal-on-Scroll via IntersectionObserver
   - Mobile-Menü Toggle */

(function () {
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
    const iconEl = document.getElementById('mobileMenuIcon');
    if (!btn || !menu) return;

    function refreshIcons() {
      if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    }
    function closeMenu() {
      menu.classList.add('hidden');
      if (iconEl) iconEl.setAttribute('data-lucide', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Menü öffnen');
      refreshIcons();
      document.body.classList.remove('menu-open');
    }
    function openMenu() {
      menu.classList.remove('hidden');
      if (iconEl) iconEl.setAttribute('data-lucide', 'x');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Menü schliessen');
      refreshIcons();
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
