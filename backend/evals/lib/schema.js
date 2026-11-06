"use strict";

/**
 * Minimal JSON-schema checker for Bedrock tool inputSchema blocks.
 * Covers what ALL_TOOL_SPECS actually uses: type, enum, properties, required.
 * No dependency on ajv — the PR tier must stay install-light.
 */

const typeOf = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

const matchesType = (value, type) => {
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeOf(value) === type;
};

/** Returns an array of human-readable problems; empty means valid. */
const validate = (value, schema, path = "input") => {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum [${schema.enum.join(", ")}]`);
  }
  if (schema.type === "object") {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required property missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) errors.push(...validate(value[key], sub, `${path}.${key}`));
    }
  }
  return errors;
};

module.exports = { validate };
