/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#030213',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#eeeef4',
          foreground: '#030213',
        },
        muted: {
          DEFAULT: '#ececf0',
          foreground: '#717182',
        },
        border: '#e6e6e6',
        background: '#ffffff',
        foreground: '#030213',
        destructive: '#d4183d',
      },
      borderRadius: {
        lg: '0.625rem',
      },
      fontFamily: {
        tabular: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
