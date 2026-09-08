/** @type {import('tailwindcss').Config} */

// Colours are declared as CSS variables (see src/index.css) and referenced
// through these semantic names. Dark mode swaps the variables rather than
// forcing every element to carry a `dark:` twin, which is what let the old
// palette drift between components.
const themed = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: themed('--canvas'),           // page background
        surface: themed('--surface'),         // cards, bars
        'surface-hover': themed('--surface-hover'),
        'surface-sunken': themed('--surface-sunken'),
        hairline: themed('--hairline'),       // borders and dividers
        ink: themed('--ink'),                 // primary text
        'ink-muted': themed('--ink-muted'),   // secondary text
        'ink-faint': themed('--ink-faint'),   // tertiary text, placeholders
        accent: themed('--accent'),
        'accent-hover': themed('--accent-hover'),
        'accent-soft': themed('--accent-soft'),
        'accent-ink': themed('--accent-ink'),
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '0.625rem',
      },
      boxShadow: {
        // Covers supply the colour, so card elevation stays quiet.
        card: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.04)',
        'card-hover': '0 8px 24px -6px rgb(0 0 0 / 0.16), 0 2px 6px rgb(0 0 0 / 0.06)',
        bar: '0 1px 0 rgb(0 0 0 / 0.04)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
