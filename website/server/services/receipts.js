// Storing and pruning payment receipts.
//
// The terms say a receipt is kept so a payment can be reviewed and disputed.
// That is only true if it is actually stored, so it is -- downscaled, because
// a full phone screenshot is ~370 KB and every field a dispute turns on
// (reference, amount, both parties, date) is still legible at 800px wide.
//
// Nothing here is allowed to fail a payment. Someone has transferred real
// money; losing the stored copy is a much smaller problem than refusing a
// genuine transfer because an image library threw.

export const RECEIPT_WIDTH_PX = 800;
export const RECEIPT_QUALITY = 72;
export const RECEIPT_RETENTION_MONTHS = 24;

let _sharp;
let _sharpFailed = false;

/** Load sharp once, and remember if it is unavailable rather than retrying
 *  a broken native module on every payment. */
async function loadSharp() {
  if (_sharp || _sharpFailed) return _sharp;
  try {
    const mod = await import("sharp");
    _sharp = mod.default ?? mod;
  } catch (err) {
    _sharpFailed = true;
    console.error("sharp unavailable, receipts stored full size:", err.message);
  }
  return _sharp;
}

/**
 * Shrink a receipt for storage. Returns {buffer, mimeType, bytes}.
 *
 * If sharp cannot load or the image cannot be read, the original is stored
 * unchanged: a larger row is better than no evidence.
 */
export async function prepareReceipt(base64, mimeType) {
  const original = Buffer.from(base64, "base64");
  const sharp = await loadSharp();
  if (!sharp) {
    return { buffer: original, mimeType, bytes: original.length, resized: false };
  }
  try {
    const out = await sharp(original)
      .rotate()                       // honour EXIF orientation from phones
      .resize({ width: RECEIPT_WIDTH_PX, withoutEnlargement: true })
      .jpeg({ quality: RECEIPT_QUALITY })
      .toBuffer();
    // A "smaller" result that is actually bigger means the source was already
    // tiny; keep whichever is smaller.
    if (out.length >= original.length) {
      return { buffer: original, mimeType, bytes: original.length, resized: false };
    }
    return { buffer: out, mimeType: "image/jpeg", bytes: out.length, resized: true };
  } catch (err) {
    console.error("receipt resize failed, storing original:", err.message);
    return { buffer: original, mimeType, bytes: original.length, resized: false };
  }
}

/** Delete receipt images past their retention date. The payment row stays. */
export async function pruneExpiredReceipts(query) {
  try {
    const { rowCount } = await query(
      `UPDATE payments
          SET screenshot_data = NULL, screenshot_kept_until = NULL
        WHERE screenshot_data IS NOT NULL
          AND screenshot_kept_until IS NOT NULL
          AND screenshot_kept_until < now()`);
    if (rowCount) console.log(`pruned ${rowCount} expired payment receipt(s)`);
    return rowCount;
  } catch (err) {
    console.error("receipt prune failed:", err.message);
    return 0;
  }
}
