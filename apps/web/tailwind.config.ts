import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#17365D',
          hover: '#254B75',
          soft: '#E6EEF8',
        },
        turquoise: {
          DEFAULT: '#0E7490',
          soft: '#CFFAFE',
        },
        surface: '#FFFFFF',
        canvas: '#F3F6FA',
      },
    },
  },
  plugins: [],
};

export default config;
