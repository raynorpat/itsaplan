// The response for a public raw-bytes route. The bytes and their content type are
// attacker-controlled and these routes are public and same-origin with the web app,
// so serving HTML or SVG inline would be stored XSS. Defenses: X-Content-Type-Options
// nosniff stops MIME sniffing, and inline rendering is allowed only for a strict media
// allowlist (raster images, video, audio). Everything else is forced to download and
// gets a locked-down CSP.
export function rawObjectResponse(
  obj: { body: BodyInit; contentType: string; contentLength?: number | null },
  contentType: string,
  filename: string,
  forceDownload: boolean,
): Response {
  const ct = contentType || obj.contentType;
  const inlineSafe = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/|audio\/)/i.test(ct);
  const inline = inlineSafe && !forceDownload;
  const headers: Record<string, string> = {
    'Content-Type': ct,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (obj.contentLength != null) headers['Content-Length'] = String(obj.contentLength);
  if (!inline) headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
  return new Response(obj.body, { headers });
}
