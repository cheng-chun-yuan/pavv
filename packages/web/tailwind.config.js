/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        pavv: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          200: "#BBF7D0",
          300: "#86EFAC",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          800: "#166534",
          900: "#14532D",
          neon: "#12FF80",
        },
        sidebar: {
          bg: "#1B2023",
          surface: "#303336",
          text: "#A1A3A7",
          border: "#3A3D41",
          hover: "#3A3D41",
        },
        dark: {
          bg: "#1B2023",
          card: "#242A2E",
          surface: "#303336",
          hover: "#3A3D41",
          border: "#4A4D51",
        },
        accent: {
          green: "#22c55e",
          red: "#ef4444",
          yellow: "#eab308",
          purple: "#8b5cf6",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};
