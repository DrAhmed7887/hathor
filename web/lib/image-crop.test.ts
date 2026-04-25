/**
 * Tests for the pure-math crop helpers in image-crop.ts.
 *
 * No image processing here — these tests exercise the integer
 * pixel arithmetic and the clamp / round / off-by-one behaviour.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  denormalizeBox,
  isUsableCrop,
  type ImageDimensions,
  type NormalizedBox,
  type PixelRect,
} from "./image-crop.ts";

const CARD = { width: 1600, height: 1050 } as const;

test("denormalize: canonical Egyptian date ROI lands at exact pixels", () => {
  // Coordinates from data/templates/egypt_mohp_child_card.json row 0.
  const date_roi: NormalizedBox = {
    x: 0.565625,
    y: 0.35428571428571426,
    width: 0.16875,
    height: 0.05904761904761905,
  };
  const rect = denormalizeBox(date_roi, CARD);
  assert.equal(rect.x, 905);
  assert.equal(rect.y, 372);
  assert.equal(rect.width, 270);
  assert.equal(rect.height, 62);
});

test("denormalize: full-image box covers the whole canvas", () => {
  const rect = denormalizeBox({ x: 0, y: 0, width: 1, height: 1 }, CARD);
  assert.deepEqual(rect, { x: 0, y: 0, width: 1600, height: 1050 });
});

test("denormalize: clamps left/top below zero to zero", () => {
  const rect = denormalizeBox({ x: -0.2, y: -0.1, width: 0.3, height: 0.3 }, CARD);
  // x clamped to 0; (x+w) clamped to 0.1; right pixel = round(0.1*1600)=160.
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
  assert.equal(rect.width, 160);
  assert.equal(rect.height, Math.round(0.2 * 1050));
});

test("denormalize: clamps right/bottom above one to image edge", () => {
  const rect = denormalizeBox({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, CARD);
  assert.equal(rect.x, 1440); // round(0.9 * 1600)
  assert.equal(rect.y, 945); // round(0.9 * 1050)
  assert.equal(rect.x + rect.width, 1600);
  assert.equal(rect.y + rect.height, 1050);
});

test("denormalize: zero-area box returns zero width/height", () => {
  const rect = denormalizeBox({ x: 0.5, y: 0.5, width: 0, height: 0 }, CARD);
  assert.equal(rect.width, 0);
  assert.equal(rect.height, 0);
});

test("denormalize: box fully outside the image collapses to zero area", () => {
  const rect = denormalizeBox({ x: 1.5, y: 1.5, width: 0.1, height: 0.1 }, CARD);
  assert.equal(rect.width, 0);
  assert.equal(rect.height, 0);
});

test("denormalize: adjacent boxes tile without overlap or gap", () => {
  // Two adjacent normalised boxes whose right and left edges meet at 0.5.
  const left = denormalizeBox({ x: 0, y: 0, width: 0.5, height: 1 }, CARD);
  const right = denormalizeBox({ x: 0.5, y: 0, width: 0.5, height: 1 }, CARD);
  assert.equal(left.x + left.width, right.x, "no gap or overlap on the seam");
  assert.equal(left.x + left.width, 800);
});

test("denormalize: throws on non-finite numbers", () => {
  assert.throws(
    () =>
      denormalizeBox(
        { x: Number.NaN, y: 0, width: 0.1, height: 0.1 },
        CARD,
      ),
    /non-finite/,
  );
  assert.throws(
    () =>
      denormalizeBox(
        { x: 0, y: Infinity, width: 0.1, height: 0.1 },
        CARD,
      ),
    /non-finite/,
  );
});

test("denormalize: throws on non-integer or non-positive image dimensions", () => {
  assert.throws(
    () =>
      denormalizeBox(
        { x: 0, y: 0, width: 0.1, height: 0.1 },
        { width: 1600.5, height: 1050 } as ImageDimensions,
      ),
    /positive integers/,
  );
  assert.throws(
    () =>
      denormalizeBox(
        { x: 0, y: 0, width: 0.1, height: 0.1 },
        { width: 0, height: 1050 } as ImageDimensions,
      ),
    /positive integers/,
  );
});

test("denormalize: throws on negative width or height", () => {
  assert.throws(
    () =>
      denormalizeBox(
        { x: 0.1, y: 0.1, width: -0.05, height: 0.1 },
        CARD,
      ),
    /non-negative/,
  );
});

test("isUsableCrop: positive in-bounds rect is usable", () => {
  const rect: PixelRect = { x: 100, y: 100, width: 200, height: 50 };
  assert.equal(isUsableCrop(rect, CARD), true);
});

test("isUsableCrop: zero-area rect is unusable", () => {
  assert.equal(
    isUsableCrop({ x: 100, y: 100, width: 0, height: 50 }, CARD),
    false,
  );
});

test("isUsableCrop: negative origin is unusable", () => {
  assert.equal(
    isUsableCrop({ x: -1, y: 100, width: 50, height: 50 }, CARD),
    false,
  );
});

test("isUsableCrop: rect that overflows the image is unusable", () => {
  assert.equal(
    isUsableCrop({ x: 1500, y: 100, width: 200, height: 50 }, CARD),
    false,
  );
});
