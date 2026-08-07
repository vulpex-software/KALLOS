/** @type {import('tailwindcss').Config} */

// La escala "brand" (dorado, por defecto) se lee de variables CSS definidas
// en src/index.css (:root, como "R G B" separado por espacios) en vez de
// hex fijos -- así theme.ts puede pisarlas en runtime cuando un salón tiene
// su propio color_primario, sin tocar este archivo ni recompilar.
function brandVar(nombre) {
  return `rgb(var(${nombre}) / <alpha-value>)`
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: brandVar('--brand-50'),
          100: brandVar('--brand-100'),
          200: brandVar('--brand-200'),
          300: brandVar('--brand-300'),
          400: brandVar('--brand-400'),
          500: brandVar('--brand-500'),
          600: brandVar('--brand-600'),
          700: brandVar('--brand-700'),
          800: brandVar('--brand-800'),
          900: brandVar('--brand-900')
        },
        // Negro/grafito de la plataforma (chrome: nav, header) -- no es
        // personalizable por salón, es la identidad de KALLOS.
        ink: '#0b0b0d',
        surface: '#17151a',
        // Sidebar/header: por defecto es el negro de KALLOS con texto
        // dorado (mismo valor que ink/brand-300), pero un salón Pro/
        // Enterprise puede pisarlo con su propio color_primario (ver
        // theme.ts) -- panel-fg se recalcula automático (blanco o negro)
        // según qué tan claro sea ese color, para que siga siendo legible.
        panel: brandVar('--panel'),
        'panel-fg': brandVar('--panel-fg'),
        // Acento que contrasta con panel -- de color_secundario si el
        // salón lo puso, si no cae de vuelta al dorado por defecto.
        accent2: brandVar('--accent2')
      }
    }
  },
  plugins: []
}
