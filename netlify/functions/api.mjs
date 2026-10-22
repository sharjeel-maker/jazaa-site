// Jazaa API: public data, password login, protected edits, image uploads.
// Storage: Netlify Blobs (built in, no extra setup).
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import defaults from "../../public/data/default.json" with { type: "json" };

const COOKIE = "jazaa_session";
const SESSION_SECONDS = 60 * 60 * 8; // 8 hours
const MAX_JSON_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const configured = () => Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD);

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || !secret()) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}
const safeEqual = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(a)).digest(),
    crypto.createHash("sha256").update(String(b)).digest()
  );
function sessionOf(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : "";
}
const isAuthed = (req) => verify(sessionOf(req));
const isMutation = (req) => req.headers.get("x-requested-with") === "jazaa";
const cookie = (value, maxAge, secure) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

const text = (v, n = 4000) => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const httpUrl = (v) => (/^https?:\/\//i.test(String(v || "")) ? String(v).slice(0, 500) : "");

function clean(data) {
  if (!data || typeof data !== "object") return null;
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : null);
  const features = list(data.features, 20);
  const providers = list(data.providers, 300);
  const faqs = list(data.faqs, 100);
  if (!features || !providers || !faqs) return null;
  const withId = (o) => o && typeof o === "object" && ID_RE.test(String(o.id));
  if (![...features, ...providers, ...faqs].every(withId)) return null;

  const settings = {};
  for (const [k, v] of Object.entries(data.settings && typeof data.settings === "object" ? data.settings : {}))
    if (/^[A-Za-z0-9_]{1,40}$/.test(k)) settings[k] = text(v, 2000);
  if (settings.shareUrl && !httpUrl(settings.shareUrl)) settings.shareUrl = "";

  return {
    settings,
    features: features.map((f) => ({
      id: String(f.id), order: num(f.order), name: text(f.name, 200), blurb: text(f.blurb), criteria: text(f.criteria),
      why: text(f.why), notes: text(f.notes),
      ranking: (Array.isArray(f.ranking) ? f.ranking : []).filter((x) => ID_RE.test(String(x))).map(String).slice(0, 100),
      alts: (Array.isArray(f.alts) ? f.alts : []).filter((a) => a && ID_RE.test(String(a.id))).slice(0, 20)
        .map((a) => ({ id: String(a.id), label: text(a.label, 300) })),
    })),
    providers: providers.map((p) => {
      const out = {
        id: String(p.id), order: num(p.order), name: text(p.name, 200), tagline: text(p.tagline, 300),
        url: httpUrl(p.url), logo: ID_RE.test(String(p.logo || "")) ? String(p.logo) : "", price: text(p.price, 600),
        free: Boolean(p.free), cbIntl: num(p.cbIntl), cbLocal: num(p.cbLocal), sources: text(p.sources, 500),
        updated: /^\d{4}-\d{2}-\d{2}$/.test(String(p.updated || "")) ? p.updated : "",
      };
      for (const f of features) {
        out[`h_${f.id}`] = text(p[`h_${f.id}`], 300);
        out[`d_${f.id}`] = text(p[`d_${f.id}`], 1500);
      }
      return out;
    }),
    faqs: faqs.map((q) => ({ id: String(q.id), order: num(q.order), q: text(q.q, 400), a: text(q.a) })),
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const secure = url.protocol === "https:";
  const store = getStore("jazaa");

  try {
    if (route === "data" && req.method === "GET") {
      const saved = await store.get("data", { type: "json" });
      return json(saved || defaults);
    }

    if (route === "img" || route.startsWith("img/")) {
      if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const id = route.slice(4);
      if (!ID_RE.test(id)) return json({ error: "Not found" }, 404);
      const found = await store.getWithMetadata(`img/${id}`, { type: "arrayBuffer" });
      if (!found) return json({ error: "Not found" }, 404);
      const type = IMAGE_TYPES.includes(found.metadata?.contentType) ? found.metadata.contentType : "application/octet-stream";
      return new Response(found.data, {
        headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    }

    if (route === "session" && req.method === "GET") {
      return isAuthed(req) ? json({ ok: true }) : json({ ok: false }, 401);
    }

    if (route === "login" && req.method === "POST") {
      if (!configured())
        return json({ error: "Set ADMIN_USER and ADMIN_PASSWORD in your Netlify environment variables, then redeploy." }, 503);
      let body = {};
      try { body = await req.json(); } catch { /* ignore */ }
      const userOk = safeEqual(body.username || "", process.env.ADMIN_USER);
      const passOk = safeEqual(body.password || "", process.env.ADMIN_PASSWORD);
      if (!(userOk && passOk)) {
        await sleep(1000); // slows down guessing
        return json({ error: "Wrong username or password." }, 401);
      }
      const token = sign({ exp: Date.now() + SESSION_SECONDS * 1000 });
      return json({ ok: true }, 200, { "set-cookie": cookie(token, SESSION_SECONDS, secure) });
    }

    if (route === "logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });
    }

    if (route === "data" && req.method === "PUT") {
      if (!isAuthed(req) || !isMutation(req)) return json({ error: "Not signed in." }, 401);
      const raw = await req.text();
      if (raw.length > MAX_JSON_BYTES) return json({ error: "That is too much data." }, 413);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return json({ error: "Invalid data." }, 400); }
      const data = clean(parsed);
      if (!data) return json({ error: "Invalid data." }, 400);
      await store.setJSON("data", data);
      return json({ ok: true });
    }

    if (route === "upload" && req.method === "POST") {
      if (!isAuthed(req) || !isMutation(req)) return json({ error: "Not signed in." }, 401);
      const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_TYPES.includes(type)) return json({ error: "Use a PNG, JPEG, WebP or GIF image." }, 415);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "Images must be under 1.5 MB." }, 413);
      const id = crypto.randomUUID();
      await store.set(`img/${id}`, buf, { metadata: { contentType: type } });
      return json({ id });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Server error. Check the function logs in Netlify." }, 500);
  }
};

export const config = { path: "/api/*" };
