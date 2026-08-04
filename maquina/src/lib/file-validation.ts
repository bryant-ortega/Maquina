/**
 * Shared file-upload validation. Currently just the PDF magic-byte
 * check used by every W-9 upload path (dj/upload-w9, vendor/upload-w9,
 * and the admin-on-behalf-of versions in (admin)/djs/[id] and
 * (admin)/vendors/[id]).
 *
 * Why this exists on top of the MIME-type + filename-extension checks
 * already in those files: both of those are attacker-controlled
 * metadata — a POST built by hand (not through the browser's file
 * picker) can claim any `Content-Type` and any filename it wants, so
 * "the browser said application/pdf and the name ends in .pdf" is a
 * hint, not a guarantee. This checks the actual bytes.
 *
 * It's still not a full parse — a well-formed PDF magic number
 * doesn't guarantee a well-formed PDF, and this app doesn't parse or
 * render these files server-side, only stores + re-serves them with
 * an explicit `contentType: 'application/pdf'` on upload (Supabase
 * Storage serves the declared type, not a sniffed one). This check's
 * job is narrower: reject the trivial case of "this obviously isn't a
 * PDF at all" before it lands in the private w9s bucket.
 */

/** Every PDF starts with this 5-byte signature ("%PDF-"), per spec. */
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d] // % P D F -

export async function looksLikePdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer())
  if (head.length < PDF_MAGIC_BYTES.length) return false
  return PDF_MAGIC_BYTES.every((byte, i) => head[i] === byte)
}
