#!/usr/bin/env node
/**
 * Feature 10.3: Template Selector
 * Selects the best outreach template variant for a given scenario/archetype/channel,
 * fills placeholders, and outputs the result to stdout.
 *
 * Usage:
 *   node scripts/select-template.mjs \
 *     --scenario=recruiter \
 *     --archetype=operational-data-architect \
 *     --channel=linkedin \
 *     --company=Panopto \
 *     --role="DataOps Engineer" \
 *     [--hm="Jane Smith"] \
 *     [--connection="John Doe"]
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = {};

for (const arg of args) {
  const m = arg.match(/^--([^=]+)=(.+)$/s);
  if (m) flags[m[1]] = m[2];
}

const VALID_SCENARIOS = ['recruiter', 'referral', 'hiring-manager'];
const VALID_CHANNELS  = ['linkedin', 'email'];

const scenario  = flags['scenario'];
const archetype = flags['archetype'];
const channel   = flags['channel'];
const company   = flags['company'];
const role      = flags['role'];
const hm        = flags['hm']         || null;
const connection = flags['connection'] || null;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const errors = [];
if (!scenario)                          errors.push('--scenario is required');
else if (!VALID_SCENARIOS.includes(scenario)) errors.push(`--scenario must be one of: ${VALID_SCENARIOS.join(', ')}`);
if (!archetype)                         errors.push('--archetype is required');
if (!channel)                           errors.push('--channel is required');
else if (!VALID_CHANNELS.includes(channel))   errors.push(`--channel must be one of: ${VALID_CHANNELS.join(', ')}`);
if (!company)                           errors.push('--company is required');
if (!role)                              errors.push('--role is required');

if (errors.length) {
  for (const e of errors) process.stderr.write(`Error: ${e}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (no dependencies)
// ---------------------------------------------------------------------------

/**
 * Parses a minimal subset of YAML: string scalars, flow sequences [a, b, c].
 * Returns { meta: Object, body: string }
 */
function parseFrontmatter(raw) {
  const parts = raw.split(/^---\s*$/m);
  // parts[0] is empty (before first ---), parts[1] is the YAML block, parts[2+] is body
  if (parts.length < 3) {
    return { meta: {}, body: raw.trim() };
  }

  const yamlBlock = parts[1];
  const body = parts.slice(2).join('---').trim();
  const meta = {};

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key   = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (!value) continue;

    // Flow sequence: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      // Strip optional surrounding quotes
      meta[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Load archetype-variants.yml to get top_proof_points
// ---------------------------------------------------------------------------

function loadArchetypes() {
  const path = join(ROOT, 'config', 'archetype-variants.yml');
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, 'utf-8');
  const archetypeMap = {};
  let currentSlug   = null;
  let inProofPoints = false;
  const proofPoints = {};

  for (const line of raw.split('\n')) {
    // Detect slug
    const slugMatch = line.match(/^\s+-\s+slug:\s+(.+)$/);
    if (slugMatch) {
      currentSlug   = slugMatch[1].trim();
      inProofPoints = false;
      proofPoints[currentSlug] = proofPoints[currentSlug] || [];
      continue;
    }

    // Detect top_proof_points block
    if (currentSlug && line.match(/^\s+top_proof_points:/)) {
      inProofPoints = true;
      continue;
    }

    // If in proof points, collect list items
    if (inProofPoints && currentSlug) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        proofPoints[currentSlug].push(itemMatch[1].trim());
        continue;
      }
      // Any non-list, non-blank line ends the block
      if (line.trim() && !line.match(/^\s+-\s+/)) {
        inProofPoints = false;
      }
    }
  }

  return proofPoints;
}

// ---------------------------------------------------------------------------
// Load all variants for the scenario
// ---------------------------------------------------------------------------

function loadVariants(scenario) {
  const dir = join(ROOT, 'templates', 'outreach', scenario);
  if (!existsSync(dir)) {
    process.stderr.write(`Error: template directory not found: ${dir}\n`);
    process.exit(1);
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  if (!files.length) {
    process.stderr.write(`Error: no variant files found in ${dir}\n`);
    process.exit(1);
  }

  return files.map(file => {
    const raw = readFileSync(join(dir, file), 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    return { file, meta, body };
  });
}

// ---------------------------------------------------------------------------
// Variant selection logic
// ---------------------------------------------------------------------------

/**
 * Score each variant on:
 *   +2  archetype_bias contains the requested archetype
 *   +1  channel matches
 *
 * Among variants sharing the highest score, pick one via weighted-random
 * (uniform weights until conversion data is available).
 */
function selectVariant(variants, archetype, channel) {
  const scored = variants.map(v => {
    let score = 0;
    const bias = Array.isArray(v.meta.archetype_bias) ? v.meta.archetype_bias : [];

    // Normalise slugs for comparison (tolerate trailing -specialist / -engineer suffixes)
    const normArchetype = archetype.toLowerCase();
    const biasMatch = bias.some(b => {
      const nb = b.toLowerCase();
      return nb === normArchetype ||
             normArchetype.startsWith(nb) ||
             nb.startsWith(normArchetype);
    });
    if (biasMatch)              score += 2;
    if (v.meta.channel === channel) score += 1;

    return { ...v, score };
  });

  const maxScore = Math.max(...scored.map(v => v.score));
  const candidates = scored.filter(v => v.score === maxScore);

  // Weighted random among candidates (uniform = simple random pick)
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

// ---------------------------------------------------------------------------
// Placeholder fill
// ---------------------------------------------------------------------------

function fillTemplate(body, replacements) {
  let result = body;
  for (const [key, value] of Object.entries(replacements)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(re, value || '');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const proofPointsMap = loadArchetypes();
const variants = loadVariants(scenario);
const selected = selectVariant(variants, archetype, channel);

// Build proof point: use archetype's first top_proof_point, or fallback
const archetypeProofPoints = proofPointsMap[archetype] || [];
const proofPoint = archetypeProofPoints[0] ||
                   'data pipeline architecture and operational intelligence';

// Build replacements map
const replacements = {
  company,
  role,
  proof_point:        proofPoint,
  hiring_manager:     hm         || (scenario === 'recruiter' ? 'there' : 'there'),
  mutual_connection:  connection || '[connection name]',
};

const filled = fillTemplate(selected.body, replacements);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

process.stdout.write(`# Selected variant: ${selected.meta.variant_id || selected.file}\n`);
process.stdout.write(`# Scenario: ${scenario} | Archetype: ${archetype} | Channel: ${channel}\n`);
process.stdout.write(`# Score: archetype_bias match + channel match = ${selected.score}\n`);
process.stdout.write('\n');
process.stdout.write(filled);
process.stdout.write('\n');
