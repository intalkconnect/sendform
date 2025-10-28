// server.js (sem dependência de express-rate-limit)
import express from "express";
import cors from "cors";
import helmet from "helmet";

// ===== ENV =====
const {
  FRESHDESK_DOMAIN,
  FRESHDESK_API_KEY,
  PORT = 3000,
} = process.env;

if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
  console.error("Defina FRESHDESK_DOMAIN e FRESHDESK_API_KEY nas variáveis de ambiente.");
  process.exit(1);
}

const app = express();

// ===== Segurança / CORS =====
app.use(helmet({ crossOriginResourcePolicy: false }));

const ALLOWED = [
  "https://ninechat.com.br",
  "https://www.ninechat.com.br",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error("CORS not allowed"), false);
    },
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    maxAge: 600,
  })
);

// Trata preflight rapidamente
app.options("/api/*", (req, res) => res.sendStatus(204));

// Aceita x-www-form-urlencoded e JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== Limitador simples por IP (janela 60s, até 20 req) =====
const hits = new Map(); // ip -> { count, ts }
const WINDOW_MS = 60_000;
const MAX_REQ = 20;

app.use("/api/", (req, res, next) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "local";
  const now = Date.now();
  const item = hits.get(ip);

  if (!item || now - item.ts > WINDOW_MS) {
    hits.set(ip, { count: 1, ts: now });
    return next();
  }

  if (item.count >= MAX_REQ) {
    res.set("Retry-After", Math.ceil((item.ts + WINDOW_MS - now) / 1000));
    return res.status(429).json({ error: "rate_limited" });
  }

  item.count++;
  next();
});

// ===== Utils =====
const b64 = (str) => Buffer.from(str, "utf8").toString("base64");
const norm = (v) => (typeof v === "string" ? v.trim() : "");
const esc = (s) =>
  norm(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ===== Endpoint =====
app.post("/api/agendar-demo", async (req, res) => {
  try {
    const {
      website, // honeypot
      nome,
      empresa,
      email,
      telefone,
      tamanho,
      mensagem,
      origem,
      canal,
      consentimento,
    } = req.body;

    // interesse[] pode vir como array ou string
    let interesse = req.body["interesse[]"] ?? req.body.interesse ?? [];
    if (!Array.isArray(interesse)) interesse = [interesse];
    interesse = interesse.filter(Boolean).map(String);

    // Honeypot
    if (norm(website)) return res.status(204).end();

    const requesterName  = norm(nome) || "Contato do site";
    const companyName    = norm(empresa) || "Empresa não informada";
    const requesterEmail = norm(email);
    const phone          = norm(telefone);
    const subject        = `Comercial LP - ${companyName}`;

    // Corpo HTML bonitinho
    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0B1220">
        <h2 style="margin:0 0 6px 0;font-size:18px">Novo contato comercial via Landing Page</h2>
        <p style="margin:0 0 12px;color:#4B5563">Criado automaticamente pela integração do site.</p>
        <ul style="padding-left:18px;margin:0 0 12px">
          <li><b>Solicitante:</b> ${esc(requesterName)}</li>
          <li><b>Empresa:</b> ${esc(companyName)}</li>
          <li><b>E-mail:</b> ${esc(requesterEmail)}</li>
          <li><b>Telefone:</b> ${esc(phone)}</li>
          <li><b>Tamanho:</b> ${esc(tamanho)}</li>
          <li><b>Interesse(s):</b> ${interesse.map(esc).join(", ") || "—"}</li>
          <li><b>Origem:</b> ${esc(origem || "Site - Agendar Demo")}</li>
          <li><b>Canal:</b> ${esc(canal || "Web")}</li>
          <li><b>Consentimento LGPD:</b> ${consentimento ? "sim" : "não"}</li>
        </ul>
        ${norm(mensagem)
          ? `<div style="margin-top:8px"><b>Observações:</b><br><div style="white-space:pre-line">${esc(mensagem)}</div></div>`
          : ""}
      </div>
    `;

    // Payload Freshdesk
    const ticket = {
      email: requesterEmail || undefined,
      name: requesterName,     // << nome correto aqui
      phone: phone || undefined,
      subject,
      status: 2,               // Open
      priority: 2,             // Medium
      source: 2,               // Portal (ajuste se quiser)
      description: html,       // HTML aceito
    };

    const resp = await fetch(`https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${b64(`${FRESHDESK_API_KEY}:X`)}`,
      },
      body: JSON.stringify(ticket),
    });

    if (!resp.ok) {
      const details = await resp.text().catch(() => "");
      return res.status(resp.status).json({ error: "freshdesk_error", details });
    }

    // Resposta vazia para o front abrir o modal de sucesso
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error" });
  }
});

// health
app.get("/", (_req, res) => res.type("text").send("OK"));

app.listen(PORT, () => console.log(`API on http://0.0.0.0:${PORT}`));
