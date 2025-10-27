// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// ==== ENV ====
// defina no Railway:
// FRESHDESK_DOMAIN=seu-dominio (sem https)
// FRESHDESK_API_KEY=xxxxxxxx
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
  })
);

// Aceita application/x-www-form-urlencoded e JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Rate limit
app.use(
  "/api/",
  rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
);

// ===== Util =====
const b64 = (str) => Buffer.from(str, "utf8").toString("base64");

// Normaliza texto simples
const norm = (v) => (typeof v === "string" ? v.trim() : "");

// Monta HTML seguro simples
const esc = (s) =>
  norm(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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

    // checkboxes interesse[] podem vir como array ou string
    let interesse = req.body["interesse[]"] ?? req.body.interesse ?? [];
    if (!Array.isArray(interesse)) interesse = [interesse];
    interesse = interesse.filter(Boolean).map(String);

    // Honeypot: se preenchido, descarta
    if (norm(website)) return res.status(204).end();

    const requesterName = norm(nome) || "Contato do site";
    const companyName   = norm(empresa) || "Empresa não informada";
    const requesterEmail = norm(email);
    const phone = norm(telefone);

    const subject = `Comercial LP - ${companyName}`;

    // Corpo bonito em HTML
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
          ? `<div style="margin-top:8px"><b>Observações:</b><br><div style="white-space:pre-line">${esc(
              mensagem
            )}</div></div>`
          : ""}
      </div>
    `;

    // Monta payload Freshdesk
    const ticket = {
      email: requesterEmail || undefined,  // se vazio, freshdesk cria "sem email"
      name: requesterName,                 // <-- AGORA vai o NOME aqui
      phone: phone || undefined,           // telefone correto
      subject,
      status: 2,                           // Open
      priority: 2,                         // Medium
      source: 2,                           // Portal (pode usar 2/3 conforme sua preferência)
      description: html,                   // Freshdesk aceita HTML neste campo
    };

    // Chama Freshdesk
    const resp = await fetch(`https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${b64(`${FRESHDESK_API_KEY}:X`)}`,
      },
      body: JSON.stringify(ticket),
    });

    if (!resp.ok) {
      let details = "";
      try { details = await resp.text(); } catch (_) {}
      return res.status(resp.status).json({ error: "freshdesk_error", details });
    }

    // Sem corpo: 204 para o frontend abrir o modal de sucesso
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error" });
  }
});

// health
app.get("/", (_req, res) => res.type("text").send("OK"));

app.listen(PORT, () => console.log(`API on http://0.0.0.0:${PORT}`));
