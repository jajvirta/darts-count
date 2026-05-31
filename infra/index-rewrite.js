// CloudFront Function (viewer-request).
// The darts app lives under a path prefix in S3 (e.g. s3://bucket/darts/...).
// S3 has no notion of a "directory index", so map directory-style requests to
// the index.html that actually exists:
//   /darts        -> /darts/index.html
//   /darts/       -> /darts/index.html
//   /darts/js/app.js (has an extension) -> unchanged
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    // No file extension in the last path segment -> treat it as a directory.
    request.uri = uri + '/index.html';
  }
  return request;
}
