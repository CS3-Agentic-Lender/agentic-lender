const config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        navy: '#1E3A8A',
        action: '#0369A1',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        text: '#0F172A',
        muted: '#475569',
        border: '#E2E8F0',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} as const;

export default config;
