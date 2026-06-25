#!/usr/bin/env node
/**
 * Composite linked shuttle preview images onto a submarine preview.
 * Uses pos/dimensions from <LinkedSubmarine> and the shuttle .sub previewimage.
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const PREVIEW_W = 640;
const PREVIEW_H = 368;

export function parseLinkedSubmarines(xml) {
  return [...xml.matchAll(/<LinkedSubmarine([^>]*)>/g)].map((m) => {
    const a = m[1];
    const get = (k) => a.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
    const dims = get('dimensions')?.split(',').map(Number);
    const pos = get('pos')?.split(',').map(Number);
    return {
      name: get('name'),
      filepath: get('filepath'),
      linkedto: get('linkedto'),
      dimensions: dims?.length === 2 ? { w: dims[0], h: dims[1] } : null,
      pos: pos?.length === 2 ? { x: pos[0], y: pos[1] } : null,
    };
  });
}

export function parseMainDimensions(xml) {
  const dims = xml.match(/<Submarine[^>]*\bdimensions="(\d+),(\d+)"/);
  if (!dims) throw new Error('dimensions not found on <Submarine> tag');
  return { w: Number(dims[1]), h: Number(dims[2]) };
}

export function resolveShuttleSubPath(linked, { barotraumaDir, targetSubPath }) {
  const targetDir = path.dirname(path.resolve(targetSubPath));
  const tries = [];

  if (linked.filepath && barotraumaDir) {
    tries.push(path.join(barotraumaDir, ...linked.filepath.split('/')));
  }
  if (linked.name) {
    tries.push(path.join(targetDir, `${linked.name}.sub`));
    if (barotraumaDir) {
      tries.push(path.join(barotraumaDir, 'Content', 'Submarines', `${linked.name}.sub`));
    }
  }

  for (const p of tries) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    `Shuttle "${linked.name}" not found. Expected e.g. ${linked.filepath || `${linked.name}.sub`} next to the main .sub.`,
  );
}

function loadPngBase64(b64) {
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

function encodePngBase64(png) {
  return PNG.sync.write(png).toString('base64');
}

function resizeNearest(src, dstW, dstH) {
  const dst = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dstW));
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dstH));
      const si = (src.width * sy + sx) << 2;
      const di = (dstW * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function blitAlpha(base, overlay, dx, dy) {
  for (let y = 0; y < overlay.height; y++) {
    for (let x = 0; x < overlay.width; x++) {
      const bx = Math.round(dx + x);
      const by = Math.round(dy + y);
      if (bx < 0 || by < 0 || bx >= base.width || by >= base.height) continue;

      const oi = (overlay.width * y + x) << 2;
      const a = overlay.data[oi + 3] / 255;
      if (a <= 0.01) continue;

      const bi = (base.width * by + bx) << 2;
      if (a >= 0.99) {
        base.data[bi] = overlay.data[oi];
        base.data[bi + 1] = overlay.data[oi + 1];
        base.data[bi + 2] = overlay.data[oi + 2];
        base.data[bi + 3] = 255;
      } else {
        base.data[bi] = Math.round(base.data[bi] * (1 - a) + overlay.data[oi] * a);
        base.data[bi + 1] = Math.round(base.data[bi + 1] * (1 - a) + overlay.data[oi + 1] * a);
        base.data[bi + 2] = Math.round(base.data[bi + 2] * (1 - a) + overlay.data[oi + 2] * a);
        base.data[bi + 3] = 255;
      }
    }
  }
}

/** Sub editor coords (origin center, Y up) → preview pixels (Y down). */
function worldToPreview(wx, wy, mainDims) {
  const s = Math.min(PREVIEW_W / mainDims.w, PREVIEW_H / mainDims.h);
  const padX = (PREVIEW_W - mainDims.w * s) / 2;
  const padY = (PREVIEW_H - mainDims.h * s) / 2;
  return {
    s,
    x: padX + (wx + mainDims.w / 2) * s,
    y: padY + (mainDims.h / 2 - wy) * s,
  };
}

/**
 * @param {string} mainPreviewBase64 — main sub preview (without shuttle)
 * @returns {string} base64 PNG
 */
export function compositeShuttlePreviews(mainPreviewBase64, {
  mainDims,
  linkedSubs,
  shuttlePreviewBase64List,
}) {
  const base = loadPngBase64(mainPreviewBase64);
  if (base.width !== PREVIEW_W || base.height !== PREVIEW_H) {
    throw new Error(`Main preview must be ${PREVIEW_W}x${PREVIEW_H} (got ${base.width}x${base.height})`);
  }

  linkedSubs.forEach((linked, i) => {
    if (!linked.pos || !linked.dimensions) {
      throw new Error(`LinkedSubmarine "${linked.name}" missing pos/dimensions`);
    }
    const shuttlePng = loadPngBase64(shuttlePreviewBase64List[i]);
    const { s } = worldToPreview(0, 0, mainDims);
    const drawW = Math.max(1, Math.round(linked.dimensions.w * s));
    const drawH = Math.max(1, Math.round(linked.dimensions.h * s));
    const scaled = resizeNearest(shuttlePng, drawW, drawH);

    const center = worldToPreview(linked.pos.x, linked.pos.y, mainDims);
    const dx = center.x - drawW / 2;
    const dy = center.y - drawH / 2;

    blitAlpha(base, scaled, dx, dy);
  });

  return encodePngBase64(base);
}
