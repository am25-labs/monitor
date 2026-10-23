import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
function source(file) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}
function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return file.endsWith("components/ui") ? [] : files(file);
    return /\.tsx?$/.test(file) && entry.name !== "translations.ts" ? [file] : [];
  });
}
const translations = new Map();
const dictionary = source(join(root, "src/shared/translations.ts"));
visit(dictionary, (node) => {
  if (ts.isPropertyAssignment(node)) {
    const key = node.name.text;
    assert.ok(!translations.has(key), `Duplicate translation: ${key}`);
    translations.set(key, node.initializer.text);
  }
});
const sources = files(join(root, "src")).map(source);
function location(file, node) {
  return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
}
function literals(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  return [];
}

test("covers every static translation call, including conditional labels", () => {
  const missing = [];
  for (const file of sources) visit(file, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = node.expression.getText(file);
    const argument = name === "t" ? node.arguments[0] : name === "translate" ? node.arguments[1] : null;
    for (const text of literals(argument))
      if (!translations.has(text)) missing.push(`${location(file, node)}: ${text}`);
  });
  assert.deepEqual(missing, []);
});

test("keeps visible text and accessible attributes localized while preserving protocol and brand names", () => {
  const technical = new Set(["Monitor by AM25", "Apache License 2.0", "NOTICE", "POST", "URL", "JSON Pointer", "Host", "Authorization: Bearer TOKEN · Content-Type: application/json"]);
  const untranslated = [];
  for (const file of sources) visit(file, (node) => {
    let text;
    if (ts.isJsxText(node)) text = node.text;
    if (ts.isJsxAttribute(node) && ["placeholder", "aria-label", "title", "alt", "label"].includes(node.name.getText(file)) && node.initializer && ts.isStringLiteral(node.initializer)) text = node.initializer.text;
    if (text === undefined) return;
    text = text.replace(/&\w+;/g, "").replace(/\s+/g, " ").trim();
    if (!/[\p{L}]/u.test(text) || technical.has(text) || /^\/?(?:api|dependencies|status)\//.test(text) || /^· \/status\/$/.test(text)) return;
    untranslated.push(`${location(file, node)}: ${text}`);
  });
  assert.deepEqual(untranslated, []);
});

test("covers shared status, incident stage, diagnostic, and history-period labels", () => {
  const maps = new Set(["statusLabels", "stageLabels", "reasons", "periods"]);
  const missing = [];
  for (const file of sources) visit(file, (node) => {
    if (!ts.isVariableDeclaration(node) || !maps.has(node.name.getText(file)) || !node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      for (const text of literals(property.initializer))
        if (!translations.has(text)) missing.push(`${location(file, property)}: ${text}`);
    }
  });
  assert.deepEqual(missing, []);
});

test("retains every interpolation field in English translations", () => {
  const fields = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of translations) {
    assert.ok(value.trim(), key);
    assert.deepEqual(fields(value), fields(key), key);
  }
});
