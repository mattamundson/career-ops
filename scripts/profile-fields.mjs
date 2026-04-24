#!/usr/bin/env node
/**
 * profile-fields.mjs
 * Centralized loader for Matt's profile data. Used by submit-* scripts.
 * Reads config/profile.yml and exports a standardized object with all fields
 * typically required by ATS forms (Greenhouse, Ashby, Lever, iCIMS, Workday).
 *
 * Usage:
 *   import { loadProfile, getFormFields } from './profile-fields.mjs';
 *   const profile = loadProfile();
 *   const fields = getFormFields();  // standardized keys
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const PROFILE_PATH = resolve(ROOT, 'config', 'profile.yml');

// Simple YAML parser — re-implements the same state machine used in auto-scan.mjs
// (Keeping self-contained to avoid cross-script dependencies)
function parseYaml(text) {
  const lines = text.split('\n');
  const result = {};
  const stack = [{ indent: -2, container: result, key: null }];

  function top() { return stack[stack.length - 1]; }

  function parseScalar(s) {
    s = s.trim().replace(/\s+#.*$/, '').trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '') return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if ((s[0] === '"' && s[s.length - 1] === '"') ||
        (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/(["'])(?:(?=(\\?))\2.)*?\1|(\s+#.*)$/g, (m, q) => q ? m : '');
    if (!line.trim()) continue;
    if (line.trimStart().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();

    while (stack.length > 1 && indent <= top().indent) stack.pop();

    if (trimmed.startsWith('- ')) {
      const body = trimmed.slice(2);
      const t = top();
      let arr = Array.isArray(t.container) ? t.container : t.listArr;
      if (!arr) { arr = []; t.listArr = arr; t.ownerObj[t.ownerKey] = arr; }
      const colonIdx = body.indexOf(':');
      if (colonIdx !== -1 && body.slice(colonIdx + 1).trim() !== '') {
        const k = body.slice(0, colonIdx).trim();
        const v = body.slice(colonIdx + 1).trim();
        const obj = { [k]: parseScalar(v) };
        arr.push(obj);
        stack.push({ indent, container: arr, key: null, currentItem: obj, isListItemMap: true });
      } else if (colonIdx !== -1) {
        const k = body.slice(0, colonIdx).trim();
        const obj = {};
        arr.push(obj);
        stack.push({ indent, container: arr, key: null, currentItem: obj, isListItemMap: true });
      } else {
        arr.push(parseScalar(body));
      }
    } else {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const valRaw = trimmed.slice(colonIdx + 1).trim();
      const t = top();

      if (t.isListItemMap && t.currentItem) {
        if (valRaw === '') {
          const newContainer = {};
          t.currentItem[key] = newContainer;
          stack.push({ indent, container: newContainer, key, ownerKey: key, ownerObj: t.currentItem });
        } else {
          t.currentItem[key] = parseScalar(valRaw);
        }
      } else if (valRaw === '') {
        const placeholder = {};
        if (Array.isArray(t.container)) {
          t.container[t.container.length - 1][key] = placeholder;
        } else {
          t.container[key] = placeholder;
        }
        stack.push({ indent, container: placeholder, key, ownerKey: key, ownerObj: Array.isArray(t.container) ? t.container[t.container.length - 1] : t.container });
      } else {
        if (Array.isArray(t.container)) {
          t.container[t.container.length - 1][key] = parseScalar(valRaw);
        } else {
          t.container[key] = parseScalar(valRaw);
        }
      }
    }
  }
  return result;
}

// ---- Public API ----

let _cached = null;

export function loadProfile() {
  if (_cached) return _cached;
  if (!existsSync(PROFILE_PATH)) {
    throw new Error(`profile.yml not found at ${PROFILE_PATH}`);
  }
  const text = readFileSync(PROFILE_PATH, 'utf8');
  _cached = parseYaml(text);
  return _cached;
}

/**
 * Returns a flat object of field-name → value mapping for use in form-fillers.
 * Covers the standard ATS field set.
 */
export function getFormFields() {
  const p = loadProfile();
  const c = p.candidate || {};
  const a = p.address || {};
  const w = p.work_authorization || {};
  const d = p.demographics || {};
  const edu = (p.education && p.education[0]) || {};
  const defaults = p.ats_defaults || {};
  const [firstName, ...rest] = (c.full_name || '').split(' ');
  const lastName = rest.pop() || '';
  const middleName = rest.join(' ');

  return {
    // Identity
    full_name:      c.full_name || '',
    first_name:     firstName || 'Matthew',
    middle_name:    middleName || 'M.',
    middle_initial: (middleName || 'M.').charAt(0) + '.',
    last_name:      lastName || 'Amundson',
    email:          c.email || '',
    phone:          c.phone || '',
    phone_country:  '+1',
    linkedin:       c.linkedin ? (c.linkedin.startsWith('http') ? c.linkedin : `https://${c.linkedin}`) : '',
    github:         c.github ? (c.github.startsWith('http') ? c.github : `https://${c.github}`) : '',
    website:        c.portfolio_url || '',
    current_title:  c.current_title || 'Head of Technology & Analytics',
    current_employer: c.current_employer || 'Greenfield Metal Sales LLC',

    // Address
    street:         a.street || '',
    street_2:       '',
    city:           a.city || 'Minneapolis',
    state:          a.state || 'MN',
    state_code:     a.state_code || 'MN',
    zip:            a.zip || '55401',
    country:        a.country || 'United States',
    country_code:   a.country_code || 'US',

    // Work Authorization
    authorized_to_work_us: w.authorized_to_work_us === true,
    sponsorship_needed:    w.sponsorship_needed === true,
    visa_status:           w.status || 'US Citizen',

    // Demographics (all "decline" by default)
    gender:            d.gender || 'decline',
    race_ethnicity:    d.race_ethnicity || 'decline',
    veteran_status:    d.veteran_status || 'decline',
    disability_status: d.disability_status || 'decline',
    hispanic_latino:   d.hispanic_latino || 'decline',

    // Education
    degree:           edu.degree || 'BS Business Administration',
    field_of_study:   edu.field || 'Economics',
    school:           edu.institution || 'Creighton University',
    school_full:      edu.institution_full || 'Creighton University - Heider College of Business',
    graduation_year:  edu.graduation_year || 2014,
    graduation_date:  edu.graduation || 'May 2014',

    // ATS form defaults
    salary_expectation: defaults.salary_expectation || '$120,000 - $160,000',
    notice_period:      defaults.notice_period || '2 weeks',
    willing_to_relocate: defaults.willing_to_relocate || false,
    willing_to_travel:  defaults.willing_to_travel || 'Up to 25%',
    remote_preference:  defaults.remote_preference || 'Remote preferred',
    earliest_start:     defaults.earliest_start || '2 weeks from offer',
    how_did_you_hear:   defaults.how_did_you_hear || 'Job Board',
    years_experience:   defaults.years_experience || '10',

    // File paths (caller can override with role-specific variants)
    resume_pdf_path: null,       // set per-application
    cover_letter_path: null,     // set per-application

    // Timezone
    timezone:        'America/Chicago',
    timezone_label:  'Central Time (CT)',
  };
}

/**
 * Gets the path to the role-specific resume PDF if it exists, otherwise fallback to default.
 */
export function getResumePath(companySlug) {
  const output = resolve(ROOT, 'output');
  if (companySlug) {
    const candidates = readdirSync(output).filter(f => f.startsWith(`cv-matt-${companySlug}`) && f.endsWith('.pdf'));
    if (candidates.length > 0) return resolve(output, candidates[0]);
  }
  // Fallback: most recent generic CV
  const all = readdirSync(output).filter(f => f.startsWith('cv-matt-') && f.endsWith('.pdf'));
  if (all.length > 0) {
    all.sort((a, b) => b.localeCompare(a));
    return resolve(output, all[0]);
  }
  return null;
}

export function getCoverLetterPath(companySlug) {
  const clDir = resolve(ROOT, 'output', 'cover-letters');
  if (!existsSync(clDir)) return null;
  if (companySlug) {
    const candidates = readdirSync(clDir).filter(f => f.startsWith(companySlug) && f.endsWith('.txt'));
    if (candidates.length > 0) return resolve(clDir, candidates[0]);
  }
  return null;
}

// CLI usage: print the computed field set
if (process.argv[1] && process.argv[1].endsWith('profile-fields.mjs')) {
  const fields = getFormFields();
  console.log(JSON.stringify(fields, null, 2));
}
