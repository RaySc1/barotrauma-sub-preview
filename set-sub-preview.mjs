#!/usr/bin/env node
/**
 * Set the preview image on a Barotrauma .sub file.
 *
 * Interactive:
 *   node set-sub-preview.mjs <target.sub>
 *
 * CLI:
 *   node set-sub-preview.mjs --list-vanilla
 *   node set-sub-preview.mjs --to target.sub --from-vanilla Kastrull
 *   node set-sub-preview.mjs --to target.sub --from-sub source.sub
 *   node set-sub-preview.mjs --to target.sub --from-png preview.png
 *   node set-sub-preview.mjs --to target.sub --composite-shuttle
 *
 * Environment:
 *   BAROTRAUMA_DIR  Path to Barotrauma install (auto-detected if unset)
 *
 * Shuttle compositing requires: npm install (pngjs)
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { gunzipSync, gzipSync } from 'zlib';
import {
  compositeShuttlePreviews,
  parseLinkedSubmarines,
  parseMainDimensions,
  resolveShuttleSubPath,
} from './preview-composite.mjs';

const PREVIEW_MAX_BYTES = 1_048_576; // ~1 MB Workshop limit (base64)

function parseArgs(argv) {
  const opts = {
    to: null,
    fromVanilla: null,
    fromSub: null,
    fromPng: null,
    exportPng: null,
    listVanilla: false,
    compositeShuttle: false,
    barotraumaDir: process.env.BAROTRAUMA_DIR || null,
    noBackup: false,
    help: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--to':
        opts.to = argv[++i];
        break;
      case '--from-vanilla':
        opts.fromVanilla = argv[++i];
        break;
      case '--from-sub':
        opts.fromSub = argv[++i];
        break;
      case '--from-png':
        opts.fromPng = argv[++i];
        break;
      case '--export-png':
        opts.exportPng = argv[++i];
        break;
      case '--barotrauma-dir':
        opts.barotraumaDir = argv[++i];
        break;
      case '--list-vanilla':
        opts.listVanilla = true;
        break;
      case '--composite-shuttle':
        opts.compositeShuttle = true;
        break;
      case '--no-backup':
        opts.noBackup = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        positional.push(a);
    }
  }

  if (!opts.to && positional.length === 1) opts.to = positional[0];
  return opts;
}

function printHelp() {
  console.log(`Barotrauma — set preview image on .sub files

Interactive:
  node set-sub-preview.mjs [target.sub]

CLI:
  node set-sub-preview.mjs --list-vanilla
  node set-sub-preview.mjs --to target.sub --from-vanilla Kastrull
  node set-sub-preview.mjs --to target.sub --from-sub source.sub
  node set-sub-preview.mjs --to target.sub --from-png image.png
  node set-sub-preview.mjs --to target.sub --export-png export.png
  node set-sub-preview.mjs --to target.sub --composite-shuttle

Options:
  --composite-shuttle       Composite linked shuttle onto existing preview
  --barotrauma-dir <path>   Barotrauma install (vanilla subs / shuttle lookup)
  --no-backup               Skip .bak-preview backup before overwrite
  BAROTRAUMA_DIR            Same as --barotrauma-dir (environment variable)

Shuttle compositing (--composite-shuttle):
  Uses the current preview as base (Sub Editor "Create" — main sub only).
  Reads <LinkedSubmarine> (pos, name, filepath) and embeds shuttle preview(s).
  Run npm install once for pngjs.

Note: PNG/JPG/WebP accepted for --from-png. Embedded preview is base64 PNG (~1 MB max
for Steam Workshop uploads).
`);
}

function findBarotraumaDir(explicit) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (!fs.existsSync(path.join(p, 'Content', 'Submarines'))) {
      throw new Error(`No Content/Submarines in: ${p}`);
    }
    return p;
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    process.env.BAROTRAUMA_DIR,
    'C:/Program Files (x86)/Steam/steamapps/common/Barotrauma',
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Steam/steamapps/common/Barotrauma'),
    path.join(home, 'Steam/steamapps/common/Barotrauma'),
    path.join(home, '.steam/steam/steamapps/common/Barotrauma'),
    path.join(home, '.local/share/Steam/steamapps/common/Barotrauma'),
  ].filter(Boolean);

  for (const c of candidates) {
    const p = path.resolve(c);
    if (fs.existsSync(path.join(p, 'Content', 'Submarines'))) return p;
  }
  return null;
}

function readSubFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const raw = fs.readFileSync(abs);
  let xml;
  try {
    xml = gunzipSync(raw).toString('utf8');
  } catch {
    throw new Error(`Not a valid .sub (gzip/XML): ${abs}`);
  }
  const tag = xml.match(/<Submarine([^>]*)>/);
  if (!tag) throw new Error(`No <Submarine> tag in ${abs}`);
  const name = tag[1].match(/\bname="([^"]*)"/)?.[1] ?? path.basename(abs, '.sub');
  const preview = tag[1].match(/\bpreviewimage="([^"]*)"/)?.[1] ?? null;
  return { abs, xml, name, preview };
}

function writeSubFile(abs, xml) {
  fs.writeFileSync(abs, gzipSync(Buffer.from(xml, 'utf8')));
}

function setPreviewInXml(xml, base64) {
  if (/\bpreviewimage="/.test(xml)) {
    return xml.replace(/\bpreviewimage="[^"]*"/, `previewimage="${base64}"`);
  }
  return xml.replace(/<Submarine([^>]*)>/, `<Submarine$1 previewimage="${base64}">`);
}

function assertPreviewSize(base64, label) {
  if (base64.length > PREVIEW_MAX_BYTES) {
    console.warn(
      `Warning: preview for "${label}" is ${(base64.length / 1024).toFixed(0)} KB (base64) — Barotrauma limit ~1024 KB.`,
    );
  }
}

function previewFromSub(subPath) {
  const sub = readSubFile(subPath);
  if (!sub.preview) throw new Error(`No previewimage in ${sub.abs}`);
  assertPreviewSize(sub.preview, sub.name);
  return { base64: sub.preview, label: sub.name, source: sub.abs };
}

function previewFromPng(pngPath) {
  const abs = path.resolve(pngPath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp && !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error(`Unsupported image format (use PNG/JPG/WebP): ${abs}`);
  }
  const base64 = buf.toString('base64');
  assertPreviewSize(base64, path.basename(abs));
  return { base64, label: path.basename(abs), source: abs };
}

function exportPreviewToPng(subPath, outPath) {
  const sub = readSubFile(subPath);
  if (!sub.preview) throw new Error(`No previewimage in ${sub.abs}`);
  const out = path.resolve(outPath);
  fs.writeFileSync(out, Buffer.from(sub.preview, 'base64'));
  console.log(`Exported: ${out} (${fs.statSync(out).size} bytes)`);
}

function applyPreview(targetPath, previewBase64, { noBackup = false, sourceLabel = '?' } = {}) {
  const target = readSubFile(targetPath);
  if (!noBackup) {
    const bak = `${target.abs}.bak-preview-${timestamp()}`;
    fs.copyFileSync(target.abs, bak);
    console.log(`Backup: ${bak}`);
  }
  const updated = setPreviewInXml(target.xml, previewBase64);
  writeSubFile(target.abs, updated);
  console.log(`Preview set: "${sourceLabel}" → ${target.name} (${path.basename(target.abs)})`);
  console.log(`  ${target.abs}`);
}

function runCompositeShuttle(targetPath, opts) {
  const barotraumaDir = findBarotraumaDir(opts.barotraumaDir);
  const target = readSubFile(targetPath);
  if (!target.preview) {
    throw new Error(
      'Target .sub has no preview. Create one in the Sub Editor (main sub only) or use --from-png first.',
    );
  }

  const linked = parseLinkedSubmarines(target.xml);
  if (linked.length === 0) {
    throw new Error('No <LinkedSubmarine> in .sub — nothing to composite.');
  }

  const mainDims = parseMainDimensions(target.xml);
  const shuttlePreviews = [];
  const shuttleNames = [];

  for (const entry of linked) {
    const shuttlePath = resolveShuttleSubPath(entry, {
      barotraumaDir,
      targetSubPath: target.abs,
    });
    const shuttle = readSubFile(shuttlePath);
    if (!shuttle.preview) {
      throw new Error(
        `Shuttle "${entry.name}" (${shuttlePath}) has no preview — open in editor and use Create once.`,
      );
    }
    shuttlePreviews.push(shuttle.preview);
    shuttleNames.push(entry.name);
    console.log(`  Shuttle: ${entry.name} ← ${shuttlePath}`);
  }

  const composed = compositeShuttlePreviews(target.preview, {
    mainDims,
    linkedSubs: linked,
    shuttlePreviewBase64List: shuttlePreviews,
  });

  assertPreviewSize(composed, `Composite (${shuttleNames.join(' + ')})`);
  applyPreview(targetPath, composed, {
    noBackup: opts.noBackup,
    sourceLabel: `Composite + ${shuttleNames.join(', ')}`,
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function listVanillaSubs(barotraumaDir) {
  const dir = path.join(barotraumaDir, 'Content', 'Submarines');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sub'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  return files.map((file, index) => {
    const abs = path.join(dir, file);
    let name = path.basename(file, '.sub');
    let hasPreview = false;
    let previewKb = 0;
    try {
      const sub = readSubFile(abs);
      name = sub.name;
      hasPreview = !!sub.preview;
      previewKb = sub.preview ? Math.round(sub.preview.length / 1024) : 0;
    } catch {
      /* skip broken subs */
    }
    return { index: index + 1, file, abs, name, hasPreview, previewKb };
  });
}

function resolveVanillaSub(barotraumaDir, query) {
  const subs = listVanillaSubs(barotraumaDir);
  const q = query.trim().toLowerCase();
  const exact = subs.filter((s) => s.name.toLowerCase() === q || s.file.toLowerCase() === `${q}.sub`);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Ambiguous: ${query} (${exact.map((s) => s.name).join(', ')})`);

  const partial = subs.filter(
    (s) => s.name.toLowerCase().includes(q) || s.file.toLowerCase().includes(q),
  );
  if (partial.length === 1) return partial;
  if (partial.length === 0) throw new Error(`Vanilla sub not found: ${query}`);
  throw new Error(`Ambiguous: ${query} — matches: ${partial.map((s) => s.name).join(', ')}`);
}

function printVanillaList(subs, barotraumaDir, { usePickNum = false } = {}) {
  console.log(`Vanilla subs (${path.join(barotraumaDir, 'Content', 'Submarines')}):\n`);
  subs.forEach((s, i) => {
    const num = usePickNum ? i + 1 : s.index;
    const prev = s.hasPreview ? `preview ~${s.previewKb} KB` : 'no preview';
    console.log(`  ${String(num).padStart(3)}. ${s.name.padEnd(28)} ${prev}`);
  });
  console.log('');
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function confirmYes(answer) {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes' || a === 'j' || a === 'ja';
}

async function pickTarget(rl, initial) {
  if (initial) return path.resolve(initial);
  const input = (await ask(rl, 'Target .sub path: ')).trim().replace(/^["']|["']$/g, '');
  if (!input) throw new Error('No target specified.');
  return path.resolve(input);
}

async function interactive(opts) {
  const barotraumaDir = findBarotraumaDir(opts.barotraumaDir);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const targetPath = await pickTarget(rl, opts.to);
    const target = readSubFile(targetPath);
    console.log(`\nTarget: ${target.name} (${target.abs})`);
    if (target.preview) console.log(`Current preview: ~${Math.round(target.preview.length / 1024)} KB (base64)\n`);

    console.log('Choose source:');
    console.log('  1) Vanilla submarine');
    console.log('  2) Another .sub file');
    console.log('  3) Custom image (PNG/JPG/WebP)');
    console.log('  4) Export current preview as PNG');
    console.log('  5) Composite linked shuttle onto preview');
    console.log('  q) Cancel\n');

    const choice = (await ask(rl, 'Choice [1-5/q]: ')).trim().toLowerCase();

    if (choice === 'q' || choice === '') {
      console.log('Cancelled.');
      return;
    }

    if (choice === '4') {
      const out = (await ask(rl, 'Export path (.png): ')).trim().replace(/^["']|["']$/g, '');
      exportPreviewToPng(targetPath, out || `${target.name}-preview.png`);
      return;
    }

    if (choice === '5') {
      const ok = (await ask(rl, 'Use current preview as base (main sub, no shuttle)? [y/N]: ')).trim();
      if (!confirmYes(ok)) {
        console.log('Cancelled.');
        return;
      }
      runCompositeShuttle(targetPath, opts);
      return;
    }

    let preview;

    if (choice === '1') {
      if (!barotraumaDir) {
        const manual = (await ask(rl, 'Barotrauma path (Steam/.../Barotrauma): ')).trim();
        if (!manual) throw new Error('Barotrauma install not found.');
        opts.barotraumaDir = manual;
      }
      const dir = findBarotraumaDir(opts.barotraumaDir);
      const subs = listVanillaSubs(dir).filter((s) => s.hasPreview);
      printVanillaList(subs, dir, { usePickNum: true });
      const pick = (await ask(rl, 'Number or name: ')).trim();
      const pickNum = Number(pick);
      const byNum =
        !Number.isNaN(pickNum) && pickNum >= 1 && pickNum <= subs.length ? subs[pickNum - 1] : null;
      const vanilla = byNum || resolveVanillaSub(dir, pick);
      preview = previewFromSub(vanilla.abs);
    } else if (choice === '2') {
      const src = (await ask(rl, 'Source .sub path: ')).trim().replace(/^["']|["']$/g, '');
      preview = previewFromSub(src);
    } else if (choice === '3') {
      const src = (await ask(rl, 'Image path (.png/.jpg/.webp): ')).trim().replace(/^["']|["']$/g, '');
      preview = previewFromPng(src);
    } else {
      throw new Error(`Invalid choice: ${choice}`);
    }

    const ok = (await ask(rl, `\nApply preview from "${preview.label}"? [y/N]: `)).trim();
    if (!confirmYes(ok)) {
      console.log('Cancelled.');
      return;
    }

    applyPreview(targetPath, preview.base64, { noBackup: opts.noBackup, sourceLabel: preview.label });
  } finally {
    rl.close();
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.listVanilla) {
    const dir = findBarotraumaDir(opts.barotraumaDir);
    if (!dir) {
      console.error('Barotrauma not found. Set BAROTRAUMA_DIR or --barotrauma-dir.');
      process.exit(1);
    }
    printVanillaList(listVanillaSubs(dir), dir);
    return;
  }

  if (opts.exportPng) {
    if (!opts.to) {
      console.error('--export-png requires --to <target.sub>');
      process.exit(1);
    }
    exportPreviewToPng(opts.to, opts.exportPng);
    return;
  }

  if (opts.compositeShuttle) {
    if (!opts.to) {
      console.error('--composite-shuttle requires --to <target.sub>');
      process.exit(1);
    }
    runCompositeShuttle(opts.to, opts);
    return;
  }

  const hasSource = opts.fromVanilla || opts.fromSub || opts.fromPng;
  if (!hasSource) {
    await interactive(opts);
    return;
  }

  if (!opts.to) {
    console.error('Missing target: --to <target.sub>');
    process.exit(1);
  }

  let preview;
  if (opts.fromVanilla) {
    const dir = findBarotraumaDir(opts.barotraumaDir);
    if (!dir) {
      console.error('Barotrauma not found. Set BAROTRAUMA_DIR or --barotrauma-dir.');
      process.exit(1);
    }
    const vanilla = resolveVanillaSub(dir, opts.fromVanilla);
    preview = previewFromSub(vanilla.abs);
  } else if (opts.fromSub) {
    preview = previewFromSub(opts.fromSub);
  } else if (opts.fromPng) {
    preview = previewFromPng(opts.fromPng);
  }

  applyPreview(opts.to, preview.base64, { noBackup: opts.noBackup, sourceLabel: preview.label });
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
