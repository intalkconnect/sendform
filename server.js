// server.js — Node 22 (ESM) — CORS + preflight + 204 no sucesso
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import axios from 'axios';
import cors from 'cors';

const app = express();

/* -------------------- CONFIG BÁSICA -------------------- */
app.use(helmet());
app.use(express.urlencoded({ extended: true })); // aceita form x-www-form-urlencoded
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

/* -------------------- CORS -------------------- */
// Domínios permitidos (ajuste se tiver staging)
const ALLOWED_ORIGINS = [
  'https://ninechat.com.br',
  'https://www.ninechat.com.br'
];

// Middleware CORS — precisa vir ANTES das rotas
app.use(
  cors({
    origin: (origin, cb) => {
      // Permite chamadas de healthchecks/CLI sem origin
      if (!origin) return cb(null, true);
      cb(null, ALLOWED_ORIGINS.includes(origin));
    },
    methods: ['POST', 'OPTIONS', 'GET'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false
  })
);

// Garante CORS também em qualquer resposta (inclui 204/erros)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // evita cache incorreto
  }
  next();
});

// Resposta ao preflight específico
app.options('/api/agendar-demo', (req, res) => {
  res.status(204).end();
});

/* -------------------- ENV OBRIGATÓRIAS -------------------- */
const { FRESHDESK_DOMAIN, FRESHDESK_API_KEY } = process.env;
if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
  console.error('Defina FRESHDESK_DOMAIN e FRESHDESK_API_KEY nas variáveis de ambiente.');
  process.exit(1);
}

/* -------------------- UTILS -------------------- */
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* -------------------- ROTAS -------------------- */
// Health (para monitoramento)
app.get('/health', (_req, res) => res.json({ ok: true }));

// (opcional) Debug de CORS para inspecionar headers no servidor
app.get('/debug/cors', (req, res) => {
  res.json({
    origin: req.headers.origin || null,
    method: req.method,
    headers: {
      accept: req.headers.accept,
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    }
  });
});

// Recebe o formulário e cria ticket no Freshdesk
app.post('/api/agendar-demo', async (req, res) => {
  const {
    website, // honeypot
    nome, empresa, email, telefone, tamanho,
    mensagem, origem, canal, consentimento
  } = req.body;

  // Honeypot: se preenchido, ignora silenciosamente
  if (website && String(website).trim() !== '') {
    return res.status(204).end();
  }

  // Regras mínimas para criar ticket
  if (!empresa || !email) {
    return res.status(400).json({ error: 'missing_fields', details: ['empresa', 'email'] });
  }

  const interesses = toArray(req.body['interesse[]'] || req.body.interesse);

  // Subject fixo + nome da empresa
  const subject = `Comercial LP - ${empresa}`;

  // Todo o restante no corpo do ticket
  const description =
`**Solicitante:** ${nome || '—'}
**Empresa:** ${empresa}
**E-mail:** ${email}
**Telefone:** ${telefone || '—'}
**Tamanho:** ${tamanho || '—'}
**Interesse(s):** ${interesses.join(', ') || '—'}
**Origem:** ${origem || '—'}
**Canal:** ${canal || '—'}
**Consentimento LGPD:** ${consentimento ? 'sim' : 'não'}

**Mensagem**
${mensagem || '—'}`;

  // Tags (opcional)
  const tags = ['lp', 'comercial'];

  try {
    const url = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`;
    const auth = Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64');

    await axios.post(
      url,
      {
        email,                         // vem do form
        phone: telefone || undefined,  // vem do form
        subject,                       // fixo + empresa
        description,                   // resto dos campos
        priority: 2,                   // (opcional) Medium
        status: 2,                     // (opcional) Open
        tags                           // (opcional)
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 15000
      }
    );

    // Sucesso: não navega nem retorna corpo (front mostra mensagem local)
    return res.status(204).end();
  } catch (err) {
    const status = err.response?.status || 500;
    const details = err.response?.data || err.message || 'unknown_error';
    return res.status(status).json({ error: 'freshdesk_error', status, details });
  }
});

/* -------------------- START -------------------- */
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));
