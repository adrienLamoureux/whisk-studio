export const buildSafeFileName = (name = ""): string =>
  name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
