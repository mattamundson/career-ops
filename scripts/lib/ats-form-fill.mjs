/**
 * Shared ATS form autofill: label/placeholder heuristics + file upload + cover textarea.
 * Used by submit-universal-playwright, submit-ashby-playwright, submit-linkedin-easy-apply.
 *
 * @param {import('playwright').Page | import('playwright').Frame | import('playwright').Locator} root
 *   Scope for queries (Page, Frame, or a container Locator e.g. LinkedIn dialog).
 * @param {ReturnType<import('../profile-fields.mjs').getFormFields>} [fields]
 */
import { readFileSync, existsSync } from 'node:fs';

export function buildAtsFieldMappings(FF) {
  const f = FF || {};
  const yoe = f.years_experience != null && f.years_experience !== '' ? String(f.years_experience) : '10';
  const cityState = [f.city, f.state || f.state_code].filter(Boolean).join(', ') || f.zip || '';
  return [
    { patterns: [/first[\s_]?name/i], value: f.first_name || '' },
    { patterns: [/last[\s_]?name/i], value: f.last_name || '' },
    { patterns: [/middle[\s_]?name/i, /m\.?i\.?$/i], value: f.middle_name || '' },
    { patterns: [/full[\s_]?name/i, /^name$/i, /^candidate[\s_]?name$/i], value: f.full_name || '' },
    { patterns: [/email|e-?mail/i], value: f.email || '' },
    { patterns: [/phone|mobile|cell|tel(eph)?one/i], value: f.phone || '' },
    { patterns: [/linkedin/i], value: f.linkedin || '' },
    { patterns: [/github|git\s*hub|portfolio|personal\s*site|website(?!.*company)/i], value: f.github || f.website || '' },
    { patterns: [/^location$/i, /city,?\s*state/i, /location/i, /^address$/i, /street/i], value: cityState || f.city || f.street || '' },
    { patterns: [/state|province/i], value: f.state || f.state_code || '' },
    { patterns: [/zip|postal/i], value: String(f.zip || '') },
    { patterns: [/country(?!.*phone)/i], value: f.country || '' },
    { patterns: [/current[\s_]?title|job[\s_]?title|position/i], value: f.current_title || '' },
    { patterns: [/current[\s_]?company|current[\s_]?employer|employer(?!.*visa)/i], value: f.current_employer || '' },
    { patterns: [/years?[\s_]?of?[\s_]?experience|total[\s_]?experience/i], value: yoe },
    { patterns: [/salary|compensation|expectation/i], value: f.salary_expectation || '' },
    { patterns: [/notice/i], value: f.notice_period || '' },
    { patterns: [/school|university|institution(?!.*visa)/i], value: f.school || f.school_full || '' },
    { patterns: [/degree|qualification/i], value: f.degree || '' },
    { patterns: [/field[\s_]?of[\s_]?study|major/i], value: f.field_of_study || '' },
    { patterns: [/gradu(ation|ate)/i], value: String(f.graduation_year || f.graduation_date || '') },
  ];
}

/**
 * @param {import('playwright').Page | import('playwright').Frame | import('playwright').Locator} formPage
 * @param {Array<{ patterns: RegExp[], value: string }>} fieldMappings
 */
export async function fillAtsTextInputs(formPage, fieldMappings) {
  const inputs = await formPage.locator('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea').all();
  for (const input of inputs) {
    try {
      if (!await input.isVisible()) continue;
      const label = await input.evaluate((el) => {
        const id = el.id;
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const name = el.getAttribute('name') || '';
        const parentLabel = el.closest('label')?.textContent?.trim() || '';
        return `${labelEl?.textContent || ''} ${ariaLabel} ${placeholder} ${name} ${parentLabel}`.trim();
      });
      if (!label) continue;
      for (const mapping of fieldMappings) {
        if (mapping.patterns.some((p) => p.test(label)) && mapping.value) {
          const currentValue = await input.inputValue().catch(() => '');
          if (!currentValue) {
            await input.fill(String(mapping.value));
            console.log(`  ✅ Filled: "${label.slice(0, 50)}" → "${String(mapping.value).slice(0, 40)}"`);
          }
          break;
        }
      }
    } catch {
      /* skip */
    }
  }
}

export async function fillAtsSelects(formPage) {
  const selects = await formPage.locator('select').all();
  for (const select of selects) {
    try {
      if (!await select.isVisible()) continue;
      const label = await select.evaluate((el) => {
        const id = el.id;
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        return (labelEl?.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim();
      });
      if (/sponsorship|visa|authorization|legally/i.test(label)) {
        const options = await select.locator('option').allTextContents();
        if (/sponsorship/i.test(label)) {
          const noOption = options.find((o) => /^no$/i.test(o.trim()));
          if (noOption) {
            await select.selectOption({ label: noOption });
            console.log(`  ✅ Selected: "${label.slice(0, 40)}" → "No"`);
          }
        } else if (/authorization|legally/i.test(label)) {
          const yesOption = options.find((o) => /^yes$/i.test(o.trim()));
          if (yesOption) {
            await select.selectOption({ label: yesOption });
            console.log(`  ✅ Selected: "${label.slice(0, 40)}" → "Yes"`);
          }
        }
      }
    } catch {
      /* skip */
    }
  }
}

/**
 * @param {import('playwright').Page | import('playwright').Frame | import('playwright').Locator} formPage
 */
export async function uploadAtsFiles(formPage, pdfPath, coverPath) {
  const fileInputs = await formPage.locator('input[type="file"]').all();
  if (fileInputs.length > 0 && existsSync(pdfPath)) {
    try {
      await fileInputs[0].setInputFiles(pdfPath);
      console.log(`  ✅ Uploaded resume: ${pdfPath}`);
      if (fileInputs.length > 1 && coverPath && existsSync(coverPath)) {
        await fileInputs[1].setInputFiles(coverPath);
        console.log(`  ✅ Uploaded cover letter: ${coverPath}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ File upload failed: ${err.message}`);
    }
  } else {
    const uploadBtn = formPage
      .locator('button:has-text("Upload"), button:has-text("Attach"), label:has-text("Upload"), label:has-text("Resume")')
      .first();
    if (await uploadBtn.count() > 0) {
      console.log('  ℹ️ Found upload button — you may need to click it manually to attach resume');
    }
  }
}

export async function fillCoverLetterTextarea(formPage, coverPath) {
  if (!coverPath || !existsSync(coverPath)) return;
  const clText = readFileSync(coverPath, 'utf8');
  const clTextarea = formPage
    .locator('textarea[name*="cover" i], textarea[id*="cover" i], textarea[aria-label*="cover" i]')
    .first();
  if (await clTextarea.count() > 0) {
    await clTextarea.fill(clText);
    console.log('  ✅ Filled cover letter textarea');
  }
}

/**
 * Run text inputs, selects, upload, and cover text — one shot (no multi-page loop).
 */
export async function runStandardAtsFill(root, getFormFieldsResult, { pdfPath, coverPath } = {}) {
  const F = getFormFieldsResult;
  const mappings = buildAtsFieldMappings(F);
  console.log('[ats-form-fill] Detecting and filling form fields...');
  await fillAtsTextInputs(root, mappings);
  await fillAtsSelects(root);
  await uploadAtsFiles(root, pdfPath, coverPath);
  await fillCoverLetterTextarea(root, coverPath);
}
