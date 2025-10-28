// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";

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

app.use(helmet({ crossOriginResourcePolicy: false }));

const ALLOWED = [
  "https://ninechat.com.br",
  "https://www.ninechat.com.br",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, cb) => (!origin || ALLOWED.includes(origin) ? cb(null, true) : cb(new Error("CORS not allowed"), false)),
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    maxAge: 600,
  })
);

app.options("/api/*", (_req, res) => res.sendStatus(204));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- utils ---
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const norm = (v) => (typeof v === "string" ? v.trim() : "");
const esc = (s) => norm(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// chamada simples ao Freshdesk
async function fd(path, init = {}) {
  const url = `https://${FRESHDESK_DOMAIN}.freshdesk.com${path}`;
  const headers = {
    Authorization: `Basic ${b64(`${FRESHDESK_API_KEY}:X`)}`,
    Accept: "application/json",
    ...init.headers,
  };
  return fetch(url, { ...init, headers });
}

// procura contato por email / mobile
async function findContact({ email, phone }) {
  if (email) {
    const r = await fd(`/api/v2/contacts?email=${encodeURIComponent(email)}`);
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.length) return list[0];
    }
  }
  if (phone) {
    const r2 = await fd(`/api/v2/contacts?mobile=${encodeURIComponent(phone)}`);
    if (r2.ok) {
      const list2 = await r2.json();
      if (Array.isArray(list2) && list2.length) return list2[0];
    }
  }
  return null;
}

// cria ou atualiza contato garantindo "name" e "mobile"
async function upsertContact({ name, email, phone }) {
  const exists = await findContact({ email, phone });
  const payload = {
    name: name || undefined,
    email: email || undefined,
    mobile: phone || undefined,
    // opcional: other fields (company_id, custom fields, etc.)
  };

  if (exists) {
    // só atualiza se faltar algo
    const needUpdate =
      (payload.name && payload.name !== exists.name) ||
      (payload.email && payload.email !== exists.email) ||
      (payload.mobile && payload.mobile !== exists.mobile);

    if (needUpdate) {
      const up = await fd(`/api/v2/contacts/${exists.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (up.ok) return up.json();
      // se falhar, usa o existente mesmo
      return exists;
    }
    return exists;
  }

  // cria
  const create = await fd(`/api/v2/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!create.ok) {
    const t = await create.text().catch(() => "");
    throw new Error(`Erro ao criar contato: ${create.status} ${t}`);
  }
  return create.json();
}

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

    let interesse = req.body["interesse[]"] ?? req.body.interesse ?? [];
    if (!Array.isArray(interesse)) interesse = [interesse];
    interesse = interesse.filter(Boolean).map(String);

    // honeypot
    if (norm(website)) return res.status(204).end();

    const requesterName  = norm(nome) || "Contato do site";
    const companyName    = norm(empresa) || "Empresa não informada";
    const requesterEmail = norm(email);
    const phone          = norm(telefone);
    const subject        = `Comercial - ${requesterName} | ${companyName}`;

    // garante contato com "name" correto
    const contact = await upsertContact({
      name: requesterName,
      email: requesterEmail,
      phone,
    });

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0B1220">
        <h2 style="margin:0 0 6px 0;font-size:18px">Novo contato comercial</h2>
         <ul style="padding-left:18px;margin:0 0 12px">
          <li><b>Solicitante:</b> ${esc(requesterName)}</li>
          <li><b>Empresa:</b> ${esc(companyName)}</li>
          <li><b>E-mail:</b> ${esc(requesterEmail)}</li>
          <li><b>Telefone:</b> ${esc(phone)}</li>
          <li><b>Tamanho:</b> ${esc(tamanho)}</li>
          <li><b>Interesse(s):</b> ${interesse.map(esc).join(", ") || "—"}</li>
          <li><b>Origem:</b> ${esc(origem || "LP")}</li>
          <li><b>Consentimento LGPD:</b> ${consentimento ? "sim" : "não"}</li>
        </ul>
        ${norm(mensagem)
          ? `<div style="margin-top:8px"><b>Observações:</b><br><div style="white-space:pre-line">${esc(mensagem)}</div></div>`
          : ""}
      </div>
    `;

    const ticket = {
      requester_id: contact.id, // << usa o contato com nome certo
      subject,
      status: 2,        // Open
      priority: 2,      // Medium
      source: 2,        // Portal (ajuste se preferir 3=Email, 7=Chat, etc.)
      description: html // HTML
    };

    const r = await fd(`/api/v2/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket),
    });

    if (!r.ok) {
      const details = await r.text().catch(() => "");
      return res.status(r.status).json({ error: "freshdesk_error", details });
    }

    return res.status(204).end();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/", (_req, res) => res.type("text").send("OK"));
app.listen(PORT, () => console.log(`API on http://0.0.0.0:${PORT}`));
