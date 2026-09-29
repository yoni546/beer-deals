#!/usr/bin/env node
/**
 * Runs the installed skill's parser (parse_price_xml.py, israeli-grocery-price-intelligence v1.6.0) on
 * every PriceFull / PromoFull fetched for a day, writing <file>.json next to each <file>.gz. Stores
 * files are read by lib/stores-file.mjs instead (the skill's parser covers prices and promotions only).
 *
 *   node scripts/ingest/parse.mjs [--day 2026-09-29]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf } from "./lib/files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PARSER = join(ROOT, ".claude", "skills", "israeli-grocery-price-intelligence", "scripts", "parse_price_xml.py");
const i = process.argv.indexOf("--day");
const cache = join(ROOT, ".ingest-cache");
const DAY = i > -1 ? process.argv[i + 1] : readdirSync(cache).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
const python = process.platform === "win32" ? "python" : "python3";

if (!existsSync(PARSER)) {
  console.error(`The skill's parser is missing (${PARSER}). Install the skill; do not substitute another parser.`);
  process.exit(1);
}

for (const publisher of readdirSync(join(cache, DAY)).filter((d) => !d.includes("."))) {
  for (const file of readdirSync(join(cache, DAY, publisher))) {
    const kind = kindOf(file);
    if (!/\.(gz|xml)$/i.test(file) || (kind !== "PriceFull" && kind !== "PromoFull")) continue;
    const input = join(cache, DAY, publisher, file);
    const output = input.replace(/\.(xml\.)?(gz|xml)$/i, ".json");
    if (existsSync(output)) continue;
    execFileSync(python, [PARSER, "--chain", publisher, "--input", input, "--output", output], {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    console.log(`${publisher}/${file} → ${output.split(/[\\/]/).pop()}`);
  }
}
