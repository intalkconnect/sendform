// server.js (Node 22, ESM)
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import axios from 'axios';

const app = express();

// Middlewares
app.use(helmet());
app.use(express.urlencoded({ extended: true })); // aceita form POST x-www-form-urlencoded
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Env obrigatórias
const { FRESHDESK_DOMAIN, FRESHDESK_API_KEY } = process.env;
if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
  console.error('Defina FRESHDESK_DOMAIN e FRESHDESK_API_KEY nas variáveis de ambiente.');
  process.exit(1);
}

// Utilitário simples
const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Rota: recebe o formulário e cria ticket no Freshdesk
app.post('/api/agendar-demo', async (req, res) => {
  const {
    website, // honeypot
    nome, empresa, email, telefone, tamanho,
    mensagem, origem, canal, consentimento
  } = req.body;

  // Anti-spam (honeypot preenchido)
  if (website && website.trim() !== '') return res.status(204).end();

  // Campos obrigatórios
  if (!nome || !empresa || !email || !telefone || !tamanho)
    return res.status(400).json({ error: 'missing_fields' });

  // Consentimento obrigatório
  if (!consentimento)
    return res.status(400).json({ error: 'consent_required' });

  const interesses = toArray(req.body['interesse[]'] || req.body.interesse);

  const subject = `Agendar contato comercial — ${empresa} (${nome})`;
  const description =
`**Origem:** ${origem || 'Site - Agendar Demo'}
**Canal:** ${canal || 'Web'}
**Solicitante:** ${nome}
**E-mail:** ${email}
**Telefone:** ${telefone}
**Empresa:** ${empresa}
**Tamanho:** ${tamanho}
**Interesse(s):** ${interesses.join(', ') || '—'}

**Contexto**
${mensagem || '—'}`;

  const tags = ['site', 'agendar-demo', ...interesses.map(i => i.toLowerCase().replace(/\s+/g,'-'))];

  // Ajuste os names para os seus campos personalizados no Freshdesk (Admin > Ticket Fields)
  const custom_fields = {
    cf_company_size: tamanho,
    cf_channel: canal || 'Web',
    cf_origin: origem || 'Site - Agendar Demo',
    cf_consent: true
  };

  try {
    const url = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`;
    const auth = Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64');

    await axios.post(
      url,
      {
        email,
        name: nome,
        phone: telefone,
        subject,
        description,
        priority: 2,
        status: 2,
        tags,
        custom_fields
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    // Sucesso: não devolve página nem corpo
    return res.status(204).end();
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: 'freshdesk_error',
      status,
      details: err.response?.data || err.message
    });
  }
});

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// Porta para Railway
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));
