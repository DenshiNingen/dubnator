import globals from "globals";

const correctnessRules = {
  "no-constant-binary-expression": "error",
  "no-dupe-keys": "error",
  "no-undef": "error",
  "no-unreachable": "error",
};

export default [
  {
    ignores: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**"],
  },
  {
    files: ["*.js", "*.jsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        JSZip: "readonly",
        module: "readonly",
        React: "readonly",
        ReactDOM: "readonly",
        Knob: "readonly",
        VSlider: "readonly",
        Meter: "readonly",
        EQCurve: "readonly",
        LED: "readonly",
        Crossfader: "readonly",
        Fader: "readonly",
        SpectrumAnalyser: "readonly",
        InteractiveFilterGraph: "readonly",
      },
    },
    rules: correctnessRules,
  },
  {
    files: ["*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: correctnessRules,
  },
];
