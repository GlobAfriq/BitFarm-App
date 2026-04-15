import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        exports: "writable",
        module: "writable",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "prefer-const": "error",
      "require-jsdoc": "off",
      "valid-jsdoc": "off"
    }
  }
];
