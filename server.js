app.post('/api/agendar-demo', async (req, res) => {
  const {
    website, // honeypot
    nome, empresa, email, telefone, tamanho,
    mensagem, origem, canal, consentimento
  } = req.body;

  if (website && website.trim() !== '') return res.status(204).end(); // anti-spam
  if (!nome || !empresa || !email || !telefone || !tamanho)
    return res.status(400).json({ error: 'missing_fields' });
  if (!consentimento)
    return res.status(400).json({ error: 'consent_required' });

  const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
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
  const custom_fields = {
    cf_company_size: tamanho,
    cf_channel: canal || 'Web',
    cf_origin: origem || 'Site - Agendar Demo',
    cf_consent: true
  };

  try {
    const url = `https://${process.env.FRESHDESK_DOMAIN}.freshdesk.com/api/v2/tickets`;
    const auth = Buffer.from(`${process.env.FRESHDESK_API_KEY}:X`).toString('base64');

    await axios.post(url, {
      email, name: nome, phone: telefone,
      subject, description, priority: 2, status: 2,
      tags, custom_fields
    }, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    // ✅ sucesso sem devolver página ou JSON
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
