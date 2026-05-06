import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "../../packages/visual-renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2329",
        muted: "#646a73",
        line: "#e5e8ef",
        brand: "#3370ff"
      }
    }
  },
  plugins: []
};

export default config;
