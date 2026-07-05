/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0A0D11",
          900: "#0F1319",
          800: "#151B22",
          700: "#1D242D",
          600: "#2A333F",
        },
        ink: {
          100: "#E6E9ED",
          300: "#B7BFC9",
          500: "#7C8794",
          700: "#4B5563",
        },
        status: {
          scheduled: "#7C8794",
          queued: "#5B8DEF",
          claimed: "#8B93F0",
          running: "#E8A33D",
          completed: "#3FBF7F",
          failed: "#E8544F",
          retrying: "#E8A33D",
          dead: "#B23A55",
          cancelled: "#4B5563",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
      },
      keyframes: {
        pulse_tick: {
          "0%": { transform: "scaleY(0.3)", opacity: "0.9" },
          "40%": { transform: "scaleY(1)", opacity: "1" },
          "100%": { transform: "scaleY(1)", opacity: "0" },
        },
      },
      animation: {
        pulse_tick: "pulse_tick 1.4s ease-out forwards",
      },
    },
  },
  plugins: [],
};
