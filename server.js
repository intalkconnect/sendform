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
// server.js (trecho da rota)
app.post('/api/agendar-demo', async (req, res) => {
  const {
    website, // honeypot
    nome, empresa, email, telefone, tamanho,
    mensagem, origem, canal, consentimento
  } = req.body;

  if (website && website.trim() !== '') return res.status(204).end(); // anti-spam
  if (!empresa || !email) return res.status(400).json({ error: 'missing_fields' });

  // interesses pode vir como "interesse" ou "interesse[]"
  const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const interesses = toArray(req.body['interesse[]'] || req.body.interesse);

  // Subject fixo + nome da empresa
  const subject = `Comercial LP - ${empresa}`;

  // Tudo o restante no corpo do ticket
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

  try {
    const url = `https://${process.env.FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`;
    const auth = Buffer.from(`${process.env.FRESHDESK_API_KEY}:X`).toString('base64');

    await axios.post(url, {
      email,                         // do form
      phone: telefone || undefined,  // do form
      subject,                       // fixo + empresa
      description,                   // resto dos campos
      priority: 2,                   // (opcional) ajuste se quiser
      status: 2,                     // (opcional) Open
      // sem custom_fields, sem group/agent
      tags: ['lp', 'comercial']      // (opcional) remova se não quiser
    }, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    return res.status(204).end(); // sucesso: não devolve página nem JSON
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
