/**
 * Static security gates for LexiFlow.
 * These run as part of `release:verify` and can also be run standalone.
 * See technical-design/13 §7 and technical-design/11 §7.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const RULES = [
  {
    id: 'no-raw-llm-fetch',
    description: 'No raw fetch() calls to LLM endpoints',
    forbidden: [
      {
        pattern: /fetch\s*\(\s*['"`].*(?:litellm|openai|anthropic|api\.)/i,
        message: 'Raw fetch to LLM endpoint detected. Use AI SDK adapter instead.',
      },
    ],
    exclude: ['**/node_modules/**', '**/tests/**', '**/scripts/**'],
  },
  {
    id: 'no-sse-parser',
    description: 'No hand-written SSE/EventSource parser',
    forbidden: [
      {
        pattern: /new\s+EventSource\s*\(/,
        message: 'Hand-written EventSource detected. Use AI SDK streaming instead.',
      },
    ],
    exclude: ['**/node_modules/**', '**/tests/**', '**/scripts/**'],
  },
  {
    id: 'no-dangerous-html',
    description: 'No dangerouslySetInnerHTML',
    forbidden: [
      {
        pattern: /dangerouslySetInnerHTML/,
        message: 'dangerouslySetInnerHTML detected. Use React text rendering instead.',
      },
    ],
    exclude: ['**/node_modules/**', '**/tests/**'],
  },
  {
    id: 'no-credentials-in-content-script',
    description: 'Content script must not access credentials',
    forbidden: [
      {
        pattern: /credential/i,
        message: 'Credential reference in content script. Credentials only in trusted contexts.',
      },
    ],
    exclude: ['**/node_modules/**'],
    includeOnly: ['src/content-ui/', 'entrypoints/content.tsx'],
  },
  {
    id: 'no-url-in-message-schema',
    description: 'Message schemas must not let an untrusted context set the model endpoint or credentials',
    // Security intent (design 05 §9, 11 §4): a content-script/page message must
    // never carry the LLM baseURL, apiKey, arbitrary headers, or fetch options —
    // those come only from trusted settings. Provenance `url`/`path` fields (the
    // web page being captured, §7.5) are DATA, not endpoint control, so they are
    // allowed. The single trusted credential-setter is exempted via an explicit
    // audit marker on its line.
    forbidden: [
      {
        pattern: /\b(baseUrl|baseURL|endpoint|headers|apiKey|fetchOptions)(?![a-zA-Z])\s*[?:]/,
        message: 'Controllable endpoint/credential field in message schema. Only trusted config may set these.',
        allowLineMarker: '@trusted-credential-input',
      },
    ],
    exclude: ['**/node_modules/**', '**/tests/**'],
    includeOnly: ['src/shared/protocol/protocol-map.ts'],
  },
];

function getSourceFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      entry.name !== 'node_modules' &&
      entry.name !== '.output' &&
      entry.name !== '.wxt'
    ) {
      results.push(...getSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function matchesExclude(filePath, patterns) {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\//g, '\\/'),
    );
    return regex.test(filePath);
  });
}

export function runStaticGates() {
  const allFiles = getSourceFiles(ROOT);
  const results = [];

  for (const rule of RULES) {
    const violations = [];
    const exclude = rule.exclude || [];

    let filesToCheck = allFiles;
    if (rule.includeOnly) {
      filesToCheck = allFiles.filter((f) =>
        rule.includeOnly.some((dir) => f.includes(dir)),
      );
    }

    for (const file of filesToCheck) {
      const relativePath = relative(ROOT, file);
      if (matchesExclude(relativePath, exclude)) continue;

      let content;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      for (const forbidden of rule.forbidden || []) {
        // Line-level scan so we can honor a per-line audit marker exemption.
        const lines = content.split('\n');
        // Build a fresh, non-global regex per line to avoid lastIndex state.
        const perLine = new RegExp(forbidden.pattern.source, forbidden.pattern.flags.replace('g', ''));
        for (const line of lines) {
          if (!perLine.test(line)) continue;
          if (forbidden.allowLineMarker && line.includes(forbidden.allowLineMarker)) continue;
          violations.push(`${relativePath}: ${forbidden.message}`);
          break;
        }
      }
    }

    results.push({
      rule: rule.id,
      passed: violations.length === 0,
      violations,
    });
  }

  const passed = results.every((r) => r.passed);
  return { passed, results };
}

const isMainModule = process.argv[1]?.endsWith('index.mjs');
if (isMainModule) {
  const { passed, results } = runStaticGates();
  console.log('\n🔒 Static Security Gates\n');
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.rule}`);
    for (const v of result.violations) {
      console.log(`   → ${v}`);
    }
  }
  console.log(`\n${passed ? '✅ All gates passed' : '❌ Some gates failed'}\n`);
  process.exit(passed ? 0 : 1);
}
