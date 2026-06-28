// ESLint config for GetCAD.
//
// The most important rule here is the BOUNDARY rule (see the `core/**` override
// below). `core/` holds framework-agnostic business logic. It must NEVER import
// from a UI framework (next, react, react-dom). This is enforced as an ERROR so
// that `npm run lint` (and therefore CI) FAILS — it does not merely warn.
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["next/core-web-vitals"],
  ignorePatterns: [
    "node_modules/",
    ".next/",
    "next-env.d.ts",
    "**/*.config.*",
    "scripts/**",
  ],
  overrides: [
    {
      // ---- BOUNDARY RULE ----
      // Anything under core/ is pure logic. Importing a framework is a build
      // failure, including dynamic import() and re-exports.
      files: ["core/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "react", message: "core/ must not import react. Keep core framework-agnostic." },
              { name: "react-dom", message: "core/ must not import react-dom. Keep core framework-agnostic." },
              { name: "next", message: "core/ must not import next. Keep core framework-agnostic." },
            ],
            patterns: [
              {
                group: [
                  "react",
                  "react/*",
                  "react-dom",
                  "react-dom/*",
                  "next",
                  "next/*",
                  "@next/*",
                ],
                message:
                  "BOUNDARY VIOLATION: core/ must import NOTHING from next/* or react. Move framework code into app/ or components/.",
              },
            ],
          },
        ],
      },
    },
  ],
};
