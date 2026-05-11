/* Tailwind Play-CDN Theme-Extension.
   Muss NACH cdn.tailwindcss.com geladen werden, BEVOR der Body gerendert wird. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eaf6ff',
          100: '#d4ecff',
          200: '#a8d8ff',
          300: '#7cc4ff',
          400: '#4eafff',
          500: '#279FF5',
          600: '#1f86d6',
          700: '#1a6cae',
          800: '#155485',
          900: '#0f3d62',
        },
        ink: {
          50:  '#f7f8fa',
          100: '#eef0f4',
          200: '#dadee6',
          500: '#5b6472',
          700: '#2b3340',
          900: '#0c1116',
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 30px rgba(15, 61, 98, 0.08)',
        glow: '0 20px 60px -10px rgba(39, 159, 245, 0.45)',
      },
      animation: {
        'fade-up': 'fadeUp 0.8s ease-out forwards',
        float: 'float 6s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
      },
      keyframes: {
        fadeUp:  { '0%': { opacity: 0, transform: 'translateY(24px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        float:   { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-12px)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
    },
  },
};
