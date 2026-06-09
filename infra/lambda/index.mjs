/* ============================================================
 * darts-practice-api — thin CRUD over DynamoDB for one user.
 * Node 20 Lambda (Function URL). No bundled deps: the AWS SDK v3 is
 * provided by the runtime and imported dynamically inside the handler
 * (so the pure helpers below stay unit-testable without the SDK).
 *
 * Storage model is intentionally thin — all analytics live client-side
 * in scoring-stats.js. This just durably holds sessions.
 *
 * Env:
 *   TABLE_NAME     DynamoDB table (pk="me", sk=id)
 *   API_TOKEN      shared secret; clients send it in the X-Api-Key header.
 *                  (NOT Authorization — with CloudFront OAC that header is
 *                  reserved for the SigV4 signature.)
 *   ORIGIN_SECRET  (optional) value CloudFront injects as X-Origin-Secret;
 *                  if set, requests missing it are rejected (blocks direct hits)
 * ============================================================ */

const PK = 'me';
const TYPES = new Set(['test', 'interleave', 'volume', 'technique']);

export function json(status, body) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Header lookup is case-insensitive (Function URL lowercases, but be safe).
export function header(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
  return undefined;
}

// Returns null when authorized, or a {statusCode,...} response when not.
// The user secret arrives in X-Api-Key; Authorization is reserved for the
// CloudFront OAC SigV4 signature and is consumed by the Function URL itself.
export function checkAuth(headers, env) {
  if (env.ORIGIN_SECRET && header(headers, 'x-origin-secret') !== env.ORIGIN_SECRET) {
    return json(403, { error: 'forbidden' });
  }
  const token = header(headers, 'x-api-key') || '';
  if (!env.API_TOKEN || token !== env.API_TOKEN) {
    return json(401, { error: 'unauthorized' });
  }
  return null;
}

// Validate + normalize an incoming session. Returns {ok, value} | {ok:false, error}.
export function validateSession(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'body must be an object' };
  const date = String(obj.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'date must be yyyy-mm-dd' };
  const type = String(obj.type || '');
  if (!TYPES.has(type)) return { ok: false, error: 'type must be one of ' + [...TYPES].join(', ') };
  const target = String(obj.target || '').trim();
  if (!target || /\s/.test(target)) return { ok: false, error: 'target must be a non-empty token with no spaces' };
  const darts = Number(obj.darts);
  if (!Number.isInteger(darts) || darts <= 0) return { ok: false, error: 'darts must be a positive integer' };
  const score = Number(obj.score);
  if (!Number.isFinite(score) || score < 0) return { ok: false, error: 'score must be a non-negative number' };
  const notes = obj.notes == null ? '' : String(obj.notes).slice(0, 500);
  return { ok: true, value: { date, type, target, darts, score, notes } };
}

// Map (method, path-after-/api) -> a route descriptor. Pure.
export function parseRoute(method, pathTail) {
  // pathTail examples: "/sessions", "/sessions/2026-06-09-abc12"
  const parts = pathTail.replace(/^\/+|\/+$/g, '').split('/'); // ["sessions"] | ["sessions","<id>"]
  if (parts[0] !== 'sessions') return { kind: 'notfound' };
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;
  if (method === 'GET' && !id) return { kind: 'list' };
  if (method === 'POST' && !id) return { kind: 'create' };
  if (method === 'PUT' && id) return { kind: 'update', id };
  if (method === 'DELETE' && id) return { kind: 'delete', id };
  if (method === 'OPTIONS') return { kind: 'options' };
  return { kind: 'notfound' };
}

// id generator — date-sortable-ish, collision-resistant enough for one user.
function makeId(date) {
  return `${date}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let _doc; // lazily-created DynamoDB document client (reused across warm invocations)
async function doc() {
  if (_doc) return _doc;
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  _doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return _doc;
}

export async function handler(event) {
  const env = process.env;
  const method = event?.requestContext?.http?.method || 'GET';
  const rawPath = event?.rawPath || '/';
  // CloudFront forwards the full path (e.g. /darts/api/sessions); route on the
  // part after the last "/api".
  const tail = rawPath.includes('/api') ? rawPath.slice(rawPath.lastIndexOf('/api') + 4) : rawPath;

  const route = parseRoute(method, tail);
  if (route.kind === 'options') return { statusCode: 204, headers: {} };
  if (route.kind === 'notfound') return json(404, { error: 'not found' });

  const denied = checkAuth(event?.headers, env);
  if (denied) return denied;

  const TABLE = env.TABLE_NAME;
  const d = await doc();
  const { QueryCommand, PutCommand, DeleteCommand, GetCommand } = await import('@aws-sdk/lib-dynamodb');

  try {
    if (route.kind === 'list') {
      const out = await d.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': PK },
      }));
      const items = (out.Items || []).map(stripKeys).sort(byDate);
      return json(200, { sessions: items });
    }

    if (route.kind === 'create') {
      const parsed = parseBody(event);
      const v = validateSession(parsed);
      if (!v.ok) return json(400, { error: v.error });
      const id = makeId(v.value.date);
      const item = { pk: PK, sk: id, id, createdAt: new Date().toISOString(), ...v.value };
      await d.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(201, { session: stripKeys(item) });
    }

    if (route.kind === 'update') {
      const existing = await d.send(new GetCommand({ TableName: TABLE, Key: { pk: PK, sk: route.id } }));
      if (!existing.Item) return json(404, { error: 'not found' });
      const parsed = parseBody(event);
      const v = validateSession(parsed);
      if (!v.ok) return json(400, { error: v.error });
      const item = { ...existing.Item, ...v.value, pk: PK, sk: route.id, id: route.id };
      await d.send(new PutCommand({ TableName: TABLE, Item: item }));
      return json(200, { session: stripKeys(item) });
    }

    if (route.kind === 'delete') {
      await d.send(new DeleteCommand({ TableName: TABLE, Key: { pk: PK, sk: route.id } }));
      return json(200, { deleted: route.id });
    }
  } catch (err) {
    console.error('handler error', err);
    return json(500, { error: 'internal error' });
  }
  return json(404, { error: 'not found' });
}

function parseBody(event) {
  if (!event || event.body == null) return null;
  let body = event.body;
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  try { return JSON.parse(body); } catch (e) { return null; }
}
function stripKeys(item) {
  const { pk, sk, ...rest } = item;
  return rest;
}
function byDate(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1);
}
