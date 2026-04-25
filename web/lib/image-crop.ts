/**
 * Pure-math helpers for converting normalized [0,1] ROI boxes into
 * integer pixel rectangles and back. NO image-processing happens
 * here — this module never opens an image, never touches sharp/jimp,
 * never mutates a buffer. The actual byte slicing lives behind the
 * `Cropper` interface in roi-extraction.ts and is wired in PR 4
 * Commit 3.
 *
 * Why round-to-nearest:
 *   The canonical Egyptian MoHP template was authored against a
 *   1600x1050 canvas with exact-rational normalised coordinates
 *   (e.g. 905/1600 = 0.565625). Round-to-nearest produces the
 *   integer pixel value the Python generator drew at — floor would
 *   shift adjacent ROIs by one pixel and re-introduce the off-by-one
 *   the synthetic generator was specifically designed to avoid.
 */

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Convert a normalized [0,1] box into an integer pixel rectangle.
 *
 * Behaviour:
 *   - All four sides are clamped to [0,1] in normalized space, then
 *     each clamped boundary is independently rounded to nearest pixel.
 *   - Boxes that fall fully outside the image return a zero-area rect
 *     at the clamped corner — the orchestrator's caller decides
 *     whether that counts as a valid crop or a guarded skip.
 *   - Throws on non-finite numeric input or non-integer / non-positive
 *     image dimensions, since silently returning {0,0,0,0} would mask
 *     a programmer error upstream.
 */
export function denormalizeBox(
  box: NormalizedBox,
  dims: ImageDimensions,
): PixelRect {
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height)
  ) {
    throw new Error(
      `denormalizeBox: box has non-finite values (x=${box.x}, y=${box.y}, ` +
        `width=${box.width}, height=${box.height})`,
    );
  }
  if (
    !Number.isInteger(dims.width) ||
    !Number.isInteger(dims.height) ||
    dims.width <= 0 ||
    dims.height <= 0
  ) {
    throw new Error(
      `denormalizeBox: image dimensions must be positive integers ` +
        `(got width=${dims.width}, height=${dims.height})`,
    );
  }
  if (box.width < 0 || box.height < 0) {
    throw new Error(
      `denormalizeBox: box width/height must be non-negative ` +
        `(width=${box.width}, height=${box.height})`,
    );
  }

  const x0 = clamp01(box.x);
  const y0 = clamp01(box.y);
  const x1 = clamp01(box.x + box.width);
  const y1 = clamp01(box.y + box.height);

  const px = Math.round(x0 * dims.width);
  const py = Math.round(y0 * dims.height);
  const pxRight = Math.min(dims.width, Math.round(x1 * dims.width));
  const pyBot = Math.min(dims.height, Math.round(y1 * dims.height));

  return {
    x: px,
    y: py,
    width: Math.max(0, pxRight - px),
    height: Math.max(0, pyBot - py),
  };
}

/** True iff the rect is entirely inside the image and has positive area. */
export function isUsableCrop(rect: PixelRect, dims: ImageDimensions): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.x < 0 || rect.y < 0) return false;
  if (rect.x + rect.width > dims.width) return false;
  if (rect.y + rect.height > dims.height) return false;
  return true;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
