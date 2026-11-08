// Configuração lida das variáveis da Cloudflare (wrangler.toml) e dos segredos.
const num = (v, d) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(x) ? x : d;
};

export function config(env) {
  const plans = [
    { id: 'mes', days: 30, cents: Math.max(100, Math.round(num(env.PRICE_30, 1990))), label: '1 mês' },
    { id: 'tri', days: 90, cents: Math.max(100, Math.round(num(env.PRICE_90, 4990))), label: '3 meses' },
    { id: 'ano', days: 365, cents: Math.max(100, Math.round(num(env.PRICE_365, 15990))), label: '1 ano' },
  ];
  return {
    brand: String(env.BRAND || 'Fornada'),
    plans,
    trialDays: Math.max(0, Math.round(num(env.TRIAL_DAYS, 7))),
    freeProducts: Math.max(1, Math.round(num(env.FREE_PRODUCTS, 5))),
    freeOrders: Math.max(1, Math.round(num(env.FREE_ORDERS, 20))),
    refundDays: Math.max(0, num(env.REFUND_DAYS, 7)),
    pixFeePct: Math.max(0, num(env.PIX_FEE_PCT, 0.99)),
    contactEmail: String(env.CONTACT_EMAIL || ''),
    ownerName: String(env.OWNER_NAME || ''),
    mpBase: String(env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, ''),
    mpToken: String(env.MP_ACCESS_TOKEN || ''),
    mpWebhookSecret: String(env.MP_WEBHOOK_SECRET || ''),
    adminPassword: String(env.ADMIN_PASSWORD || ''),
    sessionSecret: String(env.SESSION_SECRET || ''),
    pepper: String(env.PASSWORD_PEPPER || ''),
    tz: -180,
    pixExpiry: 'PT1H',
    photoMaxBytes: 95000,
    proProducts: 300,
  };
}

/** O que o navegador pode saber. Nada de segredo aqui. */
export function publicConfig(c) {
  return {
    brand: c.brand,
    plans: c.plans,
    trialDays: c.trialDays,
    freeProducts: c.freeProducts,
    freeOrders: c.freeOrders,
    refundDays: c.refundDays,
    paymentsEnabled: Boolean(c.mpToken),
    contactEmail: c.contactEmail,
    ownerName: c.ownerName,
    photoMaxBytes: c.photoMaxBytes,
  };
}
