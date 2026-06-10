const { heroui } = require("@heroui/theme/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
      colors: {
        // Primary Color (SaveCloud Blue)
        primary: {
          light: "#e0e7ff", // A lighter shade for hover/backgrounds
          DEFAULT: "#4f46e5", // The main vibrant purple-blue
          dark: "#4338ca", // A darker shade for pressed/active states
          50: "#eff6ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        // Brand Accent Colors
        indigo: {
          DEFAULT: "#4f46e5",
        },
        slate: {
          DEFAULT: "#f1f5f9", // Light gray background
        },
        // UI/Component Specific Colors
        card: {
          light: "#ffffff",
          dark: "#1e293b",
        },
        glass: {
          DEFAULT: "rgba(255, 255, 255, 0.12)",
        },
      },
    },
  },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  plugins: [
    heroui({
      themes: {
        dark: {
          colors: {
            primary: {
              DEFAULT: "#6366f1",
              foreground: "#ffffff",
            },
          },
        },
        light: {
          colors: {
            primary: {
              DEFAULT: "#6366f1",
              foreground: "#ffffff",
            },
          },
        },
      },
    }),
  ],
};
