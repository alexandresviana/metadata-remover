const crypto = require("crypto");

const SESSION_COOKIE = "mr_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_HEADER = "x-csrf-token";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (!secret) return null;
  return secret;
}

function getAppPassword() {
  return process.env.APP_PASSWORD || "";
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function signPayload(payload) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET ou APP_PASSWORD não configurado.");
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token) {
  const secret = getSessionSecret();
  if (!secret || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (!payload.csrf) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSession() {
  const csrf = crypto.randomBytes(24).toString("base64url");
  const token = signPayload({
    exp: Date.now() + SESSION_MAX_AGE_MS,
    csrf,
    v: 1,
  });
  return { token, csrf };
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyToken(cookies[SESSION_COOKIE]);
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Não autenticado." });
  }

  const csrf = req.get(CSRF_HEADER);
  if (!csrf || csrf !== session.csrf) {
    return res.status(403).json({ error: "Token CSRF inválido." });
  }

  req.session = session;
  next();
}

function requireAuthPage(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Não autenticado." });
  }
  req.session = session;
  next();
}

function verifyPassword(password) {
  const expected = getAppPassword();
  if (!expected) return false;

  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isAuthConfigured() {
  return Boolean(getAppPassword() && getSessionSecret());
}

module.exports = {
  SESSION_COOKIE,
  CSRF_HEADER,
  SESSION_MAX_AGE_MS,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth,
  requireAuthPage,
  verifyPassword,
  isAuthConfigured,
};
