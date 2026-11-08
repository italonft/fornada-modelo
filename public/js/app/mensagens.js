// Textos prontos para mandar no WhatsApp: resumo do pedido, lista de compras e divulgação do cardápio.
import { orderMath } from '../shared/calc.js';
import { brl, dayLabel, fmtNum, longDate, qtyText, timeText } from '../shared/format.js';

const qty = (q) => fmtNum(q, 3);

export function orderMessage(order, account, origin) {
  const s = account.settings;
  const m = orderMath(order);
  const first = (order.customer || '').split(' ')[0];
  const lines = [`Olá${first ? `, ${first}` : ''}! Aqui está o resumo do seu pedido nº ${order.num} na ${account.business}:`, ''];
  for (const it of order.items) lines.push(`• ${qty(it.qty)} × ${it.name}${it.price > 0 ? ` — ${brl(Math.round(it.qty * it.price))}` : ''}`);
  if (m.delivery) lines.push(`• Entrega — ${brl(m.delivery)}`);
  if (m.discount) lines.push(`• Desconto — -${brl(m.discount)}`);
  lines.push('', `*Total: ${brl(m.total)}*`);
  if (m.paid > 0) lines.push(`Já recebido: ${brl(Math.min(m.paid, m.total))}`, `Falta pagar: ${brl(m.due)}`);
  lines.push('');
  const when = [longDate(order.dueDate), timeText(order.dueTime) ? `às ${timeText(order.dueTime)}` : ''].filter(Boolean).join(' ');
  lines.push(order.delivery === 'entrega' ? `Entrega: ${when}` : `Retirada: ${when}`);
  if (order.delivery === 'entrega' && order.address) lines.push(`Endereço: ${order.address.replace(/\n/g, ', ')}`);
  if (m.due > 0 && s.pixKey) lines.push('', `Pix: ${s.pixKey}${s.pixName ? ` (${s.pixName})` : ''}`);
  if (order.token) lines.push('', `Acompanhe o pedido: ${origin}/p/${order.token}`);
  return lines.join('\n');
}

export function readyMessage(order, account) {
  const first = (order.customer || '').split(' ')[0];
  const m = orderMath(order);
  const parts = [`Olá${first ? `, ${first}` : ''}! Seu pedido nº ${order.num} está pronto${order.delivery === 'entrega' ? ' e já vai sair para entrega' : ' para retirada'}.`];
  if (m.due > 0) parts.push(`Falta pagar ${brl(m.due)}${account.settings.pixKey ? `. Pix: ${account.settings.pixKey}` : ''}.`);
  parts.push(`Obrigada pela preferência! ${account.business}`);
  return parts.join(' ');
}

export function shoppingMessage(list, period) {
  const lines = [`Lista de compras (${period}):`, ''];
  for (const it of list.shopping) {
    if (it.buy <= 0) continue;
    const pk = it.pkgQty > 0 ? ` (${it.packages} × ${qtyText(it.pkgQty, it.base)})` : '';
    lines.push(`☐ ${it.name}: ${qtyText(it.buy, it.base)}${pk}`);
  }
  if (list.total > 0) lines.push('', `Gasto estimado: ${brl(list.total)}`);
  return lines.join('\n');
}

export function menuShareMessage(account, url) {
  return `Olá! Este é o cardápio da ${account.business}. Escolha, faça seu pedido e eu confirmo pelo WhatsApp: ${url}`;
}

export function dueText(order) {
  return [dayLabel(order.dueDate), timeText(order.dueTime)].filter(Boolean).join(', ');
}
