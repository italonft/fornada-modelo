-- Fornada: contas, receitas (fichas), ingredientes, pedidos, cardápio e assinatura por Pix.
-- Dinheiro sempre em centavos. Datas em milissegundos (UTC), exceto due_date (dia local AAAA-MM-DD).

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  recovery TEXT NOT NULL,
  business TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL DEFAULT '{}',
  pro_until INTEGER NOT NULL DEFAULT 0,
  trial_until INTEGER NOT NULL DEFAULT 0,
  order_seq INTEGER NOT NULL DEFAULT 0,
  ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE resets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE items (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE price_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  pkg_qty REAL NOT NULL,
  pkg_price INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX price_log_item ON price_log (account_id, item_id, at);

CREATE TABLE fichas (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  sell INTEGER NOT NULL DEFAULT 0,
  menu INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  ficha_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX photos_account ON photos (account_id, ficha_id);

CREATE TABLE orders (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  num INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  due_date TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'app',
  seen INTEGER NOT NULL DEFAULT 1,
  month TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX orders_due ON orders (account_id, due_date);
CREATE INDEX orders_status ON orders (account_id, status);
CREATE INDEX orders_month ON orders (account_id, month, origin);

-- Assinatura Pro paga por Pix (Mercado Pago).
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  plan_days INTEGER NOT NULL,
  mp_order_id TEXT UNIQUE,
  mp_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  coupon TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  qr_code TEXT,
  qr_base64 TEXT,
  ticket_url TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER,
  last_check_at INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX payments_account ON payments (account_id, created_at);
CREATE INDEX payments_status ON payments (status, created_at);

CREATE TABLE coupons (
  code TEXT PRIMARY KEY,
  percent_off INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, ref)
);

CREATE TABLE ratelimit (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
