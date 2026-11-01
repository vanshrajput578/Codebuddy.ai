import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

const app = express();
const port = Number(process.env.PORT || 4000);
const appOrigin = process.env.APP_ORIGIN;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const maxMessageChars = 8000;

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json({ limit: "16kb", strict: true }));

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a minute." }
});

function sameOriginOnly(req, res, next) {
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (!appOrigin || origin !== appOrigin || (fetchSite && fetchSite !== "same-origin")) {
    return res.status(403).json({ error: "Request origin is not allowed." });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "nexus-api", aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/chat", sameOriginOnly, chatLimiter, async (req, res) => {
  res.set("Cache-Control", "no-store");

  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > maxMessageChars) {
    return res.status(400).json({ error: "Message must be between 1 and 8000 characters." });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "AI provider is not configured on the server." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model,
      contents: message.trim()
    });
    const answer = result.text;
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }
    return res.json({ answer });
  } catch {
    // Never return provider errors, request headers, or environment values to the client.
    return res.status(502).json({ error: "AI request failed. Check the server configuration and provider status." });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  return res.status(400).json({ error: "Invalid request." });
});

app.listen(port, () => {
  // Do not print environment variables or credentials.
  console.log(`NEXUS API listening on port ${port}`);
});
