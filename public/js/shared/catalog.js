// Ingredientes e embalagens comuns de cada tipo de negócio, sem preço (cada um paga um valor),
// com o tamanho de embalagem mais comum no mercado e o peso de 1 xícara quando a fonte informa.
// Peso de 1 xícara (240 ml): tabela do Receiteria (https://www.receiteria.com.br/dicas/conversor-de-medidas/).

const I = (key, name, unit, pkgQty, extra = {}) => ({ key, name, unit, pkgQty, kind: 'ing', ...extra });
const E = (key, name, pkgQty) => ({ key, name, unit: 'un', pkgQty, kind: 'emb' });

const COMMON = {
  farinha: I('farinha', 'Farinha de trigo', 'g', 1000, { cupG: 120 }),
  acucar: I('acucar', 'Açúcar refinado', 'g', 1000, { cupG: 200 }),
  leite: I('leite', 'Leite integral', 'ml', 1000),
  ovos: I('ovos', 'Ovos', 'un', 12),
  oleo: I('oleo', 'Óleo de soja', 'ml', 900, { cupG: 200 }),
  manteiga: I('manteiga', 'Manteiga', 'g', 200, { cupG: 200 }),
  sal: I('sal', 'Sal', 'g', 1000),
  cebola: I('cebola', 'Cebola', 'g', 1000),
  frango: I('frango', 'Peito de frango', 'g', 1000),
};

export const CATALOG = {
  confeitaria: [
    I('condensado', 'Leite condensado', 'g', 395, { cupG: 300 }),
    I('creme', 'Creme de leite', 'g', 200),
    I('chocpo', 'Chocolate em pó 50%', 'g', 200, { cupG: 90 }),
    I('chocbarra', 'Chocolate ao leite (barra)', 'g', 1000),
    COMMON.manteiga,
    COMMON.farinha,
    COMMON.acucar,
    COMMON.ovos,
    COMMON.leite,
    COMMON.oleo,
    I('leitepo', 'Leite em pó', 'g', 380, { cupG: 120 }),
    I('amido', 'Amido de milho', 'g', 500, { cupG: 120 }),
    I('coco', 'Coco ralado', 'g', 100, { cupG: 80 }),
    I('fermento', 'Fermento químico em pó', 'g', 100),
    E('forminha', 'Forminha de papel nº 4', 100),
    E('pote', 'Pote 250 ml com tampa', 25),
    E('colher', 'Colher descartável', 50),
    E('etiqueta', 'Etiqueta adesiva', 100),
  ],
  salgados: [
    COMMON.farinha,
    I('margarina', 'Margarina', 'g', 500),
    COMMON.leite,
    COMMON.ovos,
    COMMON.oleo,
    COMMON.frango,
    I('requeijao', 'Requeijão cremoso', 'g', 200),
    I('mucarela', 'Queijo muçarela', 'g', 1000),
    I('presunto', 'Presunto', 'g', 1000),
    I('rosca', 'Farinha de rosca', 'g', 500),
    COMMON.cebola,
    COMMON.sal,
    E('caixasalg', 'Caixa para salgados', 10),
    E('saco', 'Saco de papel', 100),
  ],
  marmitas: [
    I('arroz', 'Arroz branco', 'g', 5000, { cupG: 200 }),
    I('feijao', 'Feijão carioca', 'g', 1000),
    COMMON.frango,
    I('carne', 'Carne bovina (patinho)', 'g', 1000),
    COMMON.oleo,
    COMMON.cebola,
    I('alho', 'Alho', 'g', 200),
    I('tomate', 'Tomate', 'g', 1000),
    I('batata', 'Batata', 'g', 1000),
    I('macarrao', 'Macarrão', 'g', 500),
    COMMON.sal,
    E('marmitex', 'Marmitex de alumínio nº 8 com tampa', 100),
    E('talher', 'Talher descartável', 50),
    E('sacola', 'Sacola', 100),
  ],
  outro: [COMMON.farinha, COMMON.acucar, COMMON.leite, COMMON.ovos, COMMON.oleo, COMMON.manteiga, COMMON.sal, E('embalagem', 'Embalagem', 50)],
};

const P = (key, qty, unit) => ({ key, qty, unit });

export const EXAMPLES = {
  confeitaria: {
    name: 'Brigadeiro (exemplo)',
    yieldQty: 25,
    yieldUnit: 'un',
    unitWeightG: 18,
    prepMin: 40,
    parts: [P('condensado', 1, 'un'), P('manteiga', 1, 'cs'), P('chocpo', 3, 'cs'), P('forminha', 25, 'un')],
    sell: { label: 'unidade' },
    menu: { cat: 'Docinhos', desc: 'Brigadeiro tradicional, feito na hora.' },
  },
  salgados: {
    name: 'Coxinha de frango (exemplo)',
    yieldQty: 50,
    yieldUnit: 'un',
    prepMin: 150,
    parts: [P('farinha', 500, 'g'), P('leite', 500, 'ml'), P('margarina', 30, 'g'), P('frango', 500, 'g'), P('requeijao', 100, 'g'), P('cebola', 150, 'g'), P('ovos', 2, 'un'), P('rosca', 200, 'g'), P('oleo', 300, 'ml')],
    sell: { label: 'unidade' },
    menu: { cat: 'Salgados de festa', desc: 'Coxinha de festa, massa macia e recheio de frango com requeijão.' },
  },
  marmitas: {
    name: 'Marmita de frango (exemplo)',
    yieldQty: 1,
    yieldUnit: 'un',
    prepMin: 12,
    parts: [P('arroz', 100, 'g'), P('feijao', 60, 'g'), P('frango', 150, 'g'), P('oleo', 1, 'cs'), P('cebola', 20, 'g'), P('sal', 3, 'g'), P('marmitex', 1, 'un'), P('talher', 1, 'un')],
    sell: { label: 'marmita' },
    menu: { cat: 'Marmitas', desc: 'Arroz, feijão e frango grelhado.' },
  },
  outro: null,
};

/** Dados iniciais de uma conta nova. `idFn` gera os identificadores. */
export function starterData(segment, idFn) {
  const list = CATALOG[segment] || CATALOG.outro;
  const ids = {};
  const items = list.map((x) => {
    ids[x.key] = idFn();
    return { id: ids[x.key], name: x.name, kind: x.kind, unit: x.unit, pkgQty: x.pkgQty, pkgPrice: 0, cupG: x.cupG || 0, unitG: 0, stock: 0, note: '' };
  });
  const ex = EXAMPLES[segment];
  const fichas = [];
  if (ex) {
    fichas.push({
      id: idFn(),
      name: ex.name,
      yieldQty: ex.yieldQty,
      yieldUnit: ex.yieldUnit,
      unitWeightG: ex.unitWeightG || 0,
      lossPct: 0,
      prepMin: ex.prepMin,
      parts: ex.parts.filter((p) => ids[p.key]).map((p) => ({ t: 'i', id: ids[p.key], qty: p.qty, unit: p.unit })),
      sell: { on: true, label: ex.sell.label, price: 0, prices: {} },
      menu: { on: false, cat: ex.menu.cat, desc: ex.menu.desc, photo: '' },
      notes: 'Receita de exemplo. Coloque os preços que você paga nos ingredientes, ajuste as quantidades ou apague.',
    });
  }
  return { items, fichas };
}
