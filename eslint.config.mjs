import js from "@eslint/js";
import jestPlugin from "eslint-plugin-jest";

export default [
  js.configs.recommended,
  {
    plugins: {
      jest: jestPlugin
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        require: true,
        module: true,
        process: true,
        console: true,
        __dirname: true,
        ...jestPlugin.environments.globals.globals
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  }
];
