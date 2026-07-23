/**
 * Manifest check — verify the generated manifest meets security requirements.
 * See technical-design/02 §4.1 and technical-design/11 §1.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_PATH = join(process.cwd(), '.output', 'chrome-mv3', 'manifest.json');

export function checkManifest() {
  const violations = [];

  if (!existsSync(MANIFEST_PATH)) {
    return { passed: false, violations: [`Manifest not found at ${MANIFEST_PATH}`] };
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  // Must be MV3
  if (manifest.manifest_version !== 3) {
    violations.push('Must be Manifest V3');
  }

  // No static content_scripts at install time (empty array is fine)
  if (manifest.content_scripts && manifest.content_scripts.length > 0) {
    violations.push('Static content_scripts detected. Use runtime registration only.');
  }

  // No broad host_permissions at install time
  if (manifest.host_permissions && manifest.host_permissions.length > 0) {
    violations.push('Static host_permissions detected. Use optional_host_permissions only.');
  }

  // Must have optional_host_permissions for http/https
  if (!manifest.optional_host_permissions) {
    violations.push('Missing optional_host_permissions declaration.');
  } else {
    const hasHttp = manifest.optional_host_permissions.includes('http://*/*');
    const hasHttps = manifest.optional_host_permissions.includes('https://*/*');
    if (!hasHttp || !hasHttps) {
      violations.push(
        'optional_host_permissions must include both http://*/* and https://*/*',
      );
    }
  }

  // Permissions should only include what we need
  const allowedPermissions = ['storage', 'sidePanel', 'scripting', 'commands'];
  const extraPermissions = (manifest.permissions || []).filter(
    (p) => !allowedPermissions.includes(p),
  );
  if (extraPermissions.length > 0) {
    violations.push(`Unexpected permissions: ${extraPermissions.join(', ')}`);
  }

  // CSP must not allow remote scripts
  if (manifest.content_security_policy) {
    const csp = manifest.content_security_policy.extension_pages || '';
    if (csp.includes('http://') || csp.includes('https://')) {
      violations.push('CSP must not allow remote script sources.');
    }
  }

  // Command shortcuts must satisfy Chrome's accelerator rules, or Chrome
  // rejects the whole manifest at load time. Rules: a modifier (Ctrl/Alt/
  // Command/MacCtrl) plus a key; Shift is only a secondary modifier; the key
  // must be an allowed non-modifier (A-Z, 0-9, F1-F12, or a named media/
  // navigation key). Escape/Tab/Space etc. are NOT valid command keys.
  const validCommandKey = /^(?:[A-Z0-9]|F([1-9]|1[0-2])|Comma|Period|Home|End|PageUp|PageDown|Insert|Delete|Up|Down|Left|Right|Media(?:NextTrack|PlayPause|PrevTrack|Stop))$/;
  for (const [name, cmd] of Object.entries(manifest.commands || {})) {
    const combos = cmd?.suggested_key;
    if (!combos) continue;
    for (const [platform, accel] of Object.entries(combos)) {
      const parts = String(accel).split('+');
      const key = parts[parts.length - 1];
      const modifiers = parts.slice(0, -1);
      const hasPrimaryModifier = modifiers.some((m) =>
        ['Ctrl', 'Alt', 'Command', 'MacCtrl'].includes(m),
      );
      if (!hasPrimaryModifier) {
        violations.push(`commands.${name} (${platform}): "${accel}" needs a Ctrl/Alt/Command modifier.`);
      }
      if (!validCommandKey.test(key)) {
        violations.push(`commands.${name} (${platform}): "${key}" is not a valid Chrome command key (Escape/Tab/etc. are rejected).`);
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

const isMainModule = process.argv[1]?.endsWith('manifest-check.mjs');
if (isMainModule) {
  const { passed, violations } = checkManifest();
  console.log('\n📋 Manifest Security Check\n');
  for (const v of violations) {
    console.log(`  ❌ ${v}`);
  }
  if (passed) {
    console.log('  ✅ All manifest checks passed');
  }
  console.log();
  process.exit(passed ? 0 : 1);
}
