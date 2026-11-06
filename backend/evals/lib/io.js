"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Writes JSON formatted with the repo's prettier config so `format:check` stays green. */
const writeJson = async (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const prettier = require("prettier");
    const config = (await prettier.resolveConfig(file)) || {};
    text = await prettier.format(text, { ...config, filepath: file });
  } catch {
    // prettier is a devDependency; plain JSON is fine without it.
  }
  fs.writeFileSync(file, text);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : [];

const writeJsonl = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

module.exports = { writeJson, readJson, readJsonl, writeJsonl };
