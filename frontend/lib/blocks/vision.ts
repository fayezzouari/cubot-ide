// Camera image analysis, written to mirror the OpenCV pipeline in the exported
// Python (`inspect_part`), so a program sorts the same way in the simulator
// and on a real cell:
//
//   roi  = centre crop of the frame
//   hsv  = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)       H 0-180, S/V 0-255
//   mask = cv2.inRange(hsv, lo, hi) per colour class  (red wraps around H=0)
//   area = cv2.countNonZero(mask); the largest class over min_area wins
//   cx, cy from cv2.moments(mask); bbox from the mask
//   defect = dark pixels (V < defect_v) enclosed by the part's mask

export interface ColorClass {
  name: string; // becomes part_color
  swatch: string; // display only
  hLow: number; // 0-180; hLow > hHigh wraps around red
  hHigh: number;
  sMin: number; // 0-255
  vMin: number; // 0-255
}

export interface VisionConfig {
  classes: ColorClass[];
  roi: number; // centre crop, fraction of width and height (0.1-1)
  minArea: number; // % of the ROI a class must cover to count as a part
  defectV: number; // pixels darker than this inside the part are marks
  defectArea: number; // % of the part's area that must be marks to flag a defect
}

export const DEFAULT_VISION: VisionConfig = {
  // The robot's orange joints sit at H ≈ 11, between red and yellow: keep
  // that gap so a passing arm is never read as a part.
  classes: [
    { name: 'red', swatch: '#ef4444', hLow: 170, hHigh: 8, sMin: 90, vMin: 60 },
    { name: 'yellow', swatch: '#facc15', hLow: 18, hHigh: 35, sMin: 90, vMin: 60 },
    { name: 'green', swatch: '#22c55e', hLow: 40, hHigh: 85, sMin: 90, vMin: 50 },
    { name: 'blue', swatch: '#3b82f6', hLow: 95, hHigh: 130, sMin: 90, vMin: 60 },
  ],
  roi: 0.35,
  minArea: 6,
  defectV: 60,
  defectArea: 2,
};

export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array; // RGBA, row 0 at the top
}

export interface VisionResult {
  color: string; // class name or "none"
  defect: boolean;
  area: number; // % of the ROI covered by the winning class
  cx: number; // centroid in the ROI, -1 (left) … 1 (right)
  cy: number; // -1 (top) … 1 (bottom)
  roi: { x: number; y: number; w: number; h: number }; // in frame pixels
  bbox: { x: number; y: number; w: number; h: number } | null; // in frame pixels
  defectPixels: number;
  scores: Record<string, number>; // % of ROI per class
  mask: Uint8Array | null; // frame-sized, 1 = winning class
}

// OpenCV's HSV for 8-bit images: H in 0-180, S and V in 0-255.
export function hsvCv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : (255 * d) / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (60 * (g - b)) / d;
    else if (max === g) h = 120 + (60 * (b - r)) / d;
    else h = 240 + (60 * (r - g)) / d;
    if (h < 0) h += 360;
  }
  return [h / 2, s, v];
}

export function inClass(c: ColorClass, h: number, s: number, v: number): boolean {
  if (s < c.sMin || v < c.vMin) return false;
  return c.hLow <= c.hHigh ? h >= c.hLow && h <= c.hHigh : h >= c.hLow || h <= c.hHigh;
}

export function roiRect(width: number, height: number, roi: number) {
  const f = Math.max(0.05, Math.min(1, roi));
  const w = Math.max(1, Math.round(width * f));
  const h = Math.max(1, Math.round(height * f));
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h };
}

export function analyze(frame: Frame, cfg: VisionConfig): VisionResult {
  const { width, height, data } = frame;
  const roi = roiRect(width, height, cfg.roi);
  const roiPixels = roi.w * roi.h;
  const counts = new Array(cfg.classes.length).fill(0);
  const label = new Int8Array(width * height).fill(-1);
  const value = new Uint8Array(width * height);

  for (let y = roi.y; y < roi.y + roi.h; y++) {
    for (let x = roi.x; x < roi.x + roi.w; x++) {
      const i = y * width + x;
      const [h, s, v] = hsvCv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      value[i] = v;
      for (let k = 0; k < cfg.classes.length; k++) {
        if (inClass(cfg.classes[k], h, s, v)) {
          counts[k]++;
          label[i] = k;
          break;
        }
      }
    }
  }

  const scores: Record<string, number> = {};
  cfg.classes.forEach((c, k) => (scores[c.name] = (100 * counts[k]) / roiPixels));
  let best = -1;
  for (let k = 0; k < counts.length; k++) {
    if ((100 * counts[k]) / roiPixels >= cfg.minArea && (best < 0 || counts[k] > counts[best])) best = k;
  }
  const none: VisionResult = { color: 'none', defect: false, area: 0, cx: 0, cy: 0, roi, bbox: null, defectPixels: 0, scores, mask: null };
  if (best < 0) return none;

  // Mask, moments and bounding box of the winning class.
  const mask = new Uint8Array(width * height);
  let m00 = 0;
  let m10 = 0;
  let m01 = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = roi.y; y < roi.y + roi.h; y++) {
    for (let x = roi.x; x < roi.x + roi.w; x++) {
      const i = y * width + x;
      if (label[i] !== best) continue;
      mask[i] = 1;
      m00++;
      m10 += x;
      m01 += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  // Defect marks: dark pixels enclosed by the part, i.e. inside the mask's
  // span on both their row and their column (holes in the mask).
  const rowSpan = new Map<number, [number, number]>();
  const colSpan = new Map<number, [number, number]>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask[y * width + x]) continue;
      const r = rowSpan.get(y);
      rowSpan.set(y, r ? [Math.min(r[0], x), Math.max(r[1], x)] : [x, x]);
      const c = colSpan.get(x);
      colSpan.set(x, c ? [Math.min(c[0], y), Math.max(c[1], y)] : [y, y]);
    }
  }
  let dark = 0;
  for (let y = y0; y <= y1; y++) {
    const r = rowSpan.get(y);
    if (!r) continue;
    for (let x = r[0] + 1; x < r[1]; x++) {
      const i = y * width + x;
      if (mask[i] || value[i] >= cfg.defectV) continue;
      const c = colSpan.get(x);
      if (c && y > c[0] && y < c[1]) dark++;
    }
  }

  return {
    color: cfg.classes[best].name,
    defect: (100 * dark) / m00 >= cfg.defectArea,
    area: (100 * m00) / roiPixels,
    cx: ((m10 / m00 - roi.x) / roi.w) * 2 - 1,
    cy: ((m01 / m00 - roi.y) / roi.h) * 2 - 1,
    roi,
    bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    defectPixels: dark,
    scores,
    mask,
  };
}

// Accepts saved settings, filling anything missing with defaults.
export function parseVision(raw: unknown): VisionConfig {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_VISION);
  const r = raw as Partial<VisionConfig>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const classes = Array.isArray(r.classes)
    ? r.classes
        .filter((c) => c && typeof c.name === 'string')
        .map((c) => ({
          name: c.name,
          swatch: typeof c.swatch === 'string' ? c.swatch : '#a1a1aa',
          hLow: num(c.hLow, 0),
          hHigh: num(c.hHigh, 180),
          sMin: num(c.sMin, 90),
          vMin: num(c.vMin, 60),
        }))
    : structuredClone(DEFAULT_VISION.classes);
  return {
    classes,
    roi: num(r.roi, DEFAULT_VISION.roi),
    minArea: num(r.minArea, DEFAULT_VISION.minArea),
    defectV: num(r.defectV, DEFAULT_VISION.defectV),
    defectArea: num(r.defectArea, DEFAULT_VISION.defectArea),
  };
}
