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
      refreshIcons();
      document.body.style.overflow = '';
    }
    function openMenu() {
      menu.classList.remove('hidden');
      if (iconEl) iconEl.setAttribute('data-lucide', 'x');
      refreshIcons();
    }

    btn.addEventListener('click', function () {
      if (menu.classList.contains('hidden')) openMenu(); else closeMenu();
    });
    document.querySelectorAll('.mobile-link').forEach(function (a) {
      a.addEventListener('click', closeMenu);
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
