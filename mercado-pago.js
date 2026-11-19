const MONEY = "(?:-\\s*)?(?:R\\$\\s*)?(?:-\\s*)?\\d[\\d.]*,\\d{2}-?";

function cents(value) {
  const amount = Number(value.replace(/\D/g, ""));
  return value.includes("-") ? -amount : amount;
}

function normalize(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function fullDate(day, month, year) {
  return `${year}-${month}-${day}`;
}

function lastDay(month) {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}

function pixId(text) {
  return text.match(/\bE\d{20}[A-Z0-9]{11}\b/i)?.[0].toUpperCase() || "";
}

export function parseMercadoPagoAccount(text, expectedCnpj, month) {
  const header = text.split(/DETALHE DOS MOVIMENTOS/i)[0];
  if (!/EXTRATO DE CONTA/i.test(header) || !/Mercado Pago Institui/i.test(text)) {
    throw new Error("Selecione o PDF Extrato de conta do Mercado Pago.");
  }
  const cnpj = header.match(/CPF\s*\/\s*CNPJ:\s*([\d./-]+)/i)?.[1].replace(/\D/g, "");
  if (cnpj !== expectedCnpj) {
    throw new Error("O CNPJ do extrato nao corresponde a esta unidade.");
  }
  const period = header.match(/\bde\s+(\d{2})-(\d{2})-(\d{4})\s+(?:al|a|at[eé])\s+(\d{2})-(\d{2})-(\d{4})/i);
  if (!period || fullDate(...period.slice(1, 4)) !== `${month}-01` || fullDate(...period.slice(4)) !== lastDay(month)) {
    throw new Error("Selecione o extrato do mes completo indicado no formulario.");
  }

  const labels = ["saldo inicial", "entradas", "saidas", "saldo final"];
  const totals = labels.map((label) => normalize(header).match(new RegExp(`${label}\\s*:\\s*(${MONEY})`, "i"))?.[1]);
  if (totals.some((value) => value === undefined)) {
    throw new Error("Nao encontrei os saldos e os totais no extrato da conta.");
  }
  const [opening, incoming, outgoing, closing] = totals.map(cents);
  const debits = Math.abs(outgoing);
  if (opening + incoming - debits !== closing) {
    throw new Error("Saldo inicial, entradas e saidas nao conferem com o saldo final.");
  }

  const lines = text.split("\n");
  const rowPattern = new RegExp(`^(\\d{2})-(\\d{2})-(\\d{4})\\s+(.*?)\\s*(\\d{8,})\\s+(R\\$\\s*-?[\\d.]+,\\d{2})\\s+(R\\$\\s*-?[\\d.]+,\\d{2})$`);
  const movements = lines.flatMap((line, index) => {
    const row = line.match(rowPattern);
    if (!row) return [];
    const [, day, periodMonth, year, inline, id, value, balance] = row;
    // PDF.js can place the description on the previous line when its baseline differs.
    const previous = lines[index - 1] || "";
    const next = lines[index + 1] || "";
    const description = [inline || (/libera|pix|transfer|retirada|pagamento|estorno/i.test(previous) && !/R\$/.test(previous) ? previous : ""),
      /^cancelad[ao]\b/i.test(next) ? next : ""].filter(Boolean).join(" ");
    return [{ date: fullDate(day, periodMonth, year), id, description, value: cents(value), balance: cents(balance), pixId: pixId(description) }];
  });
  let balance = opening;
  const ledgerMatches = movements.every((row) => {
    balance += row.value;
    return balance === row.balance && row.date.startsWith(`${month}-`);
  });
  const creditTotal = movements.reduce((sum, row) => sum + Math.max(row.value, 0), 0);
  const debitTotal = movements.reduce((sum, row) => sum + Math.max(-row.value, 0), 0);
  const detailsVerified = ledgerMatches && creditTotal === incoming && debitTotal === debits && balance === closing;
  const released = movements.filter((row) => row.value > 0 && /liberacao de dinheiro/.test(normalize(row.description)));
  const reversals = movements.filter((row) => row.value < 0 && /cancelad|estorno/.test(normalize(row.description)));
  return {
    openingBalance: opening / 100, credits: incoming / 100, debits: debits / 100, closingBalance: closing / 100,
    detailsVerified, movements,
    released: released.reduce((sum, row) => sum + row.value, 0) / 100,
    reversed: reversals.reduce((sum, row) => sum - row.value, 0) / 100
  };
}

export function parseItauPix(text, month) {
  const statementEnd = text.match(/saldo em\s+\d{2}\/\d{2}\/\d{2}\s+saldo em\s+(\d{2})\/(\d{2})\/(\d{2})/i);
  const through = statementEnd ? fullDate(statementEnd[1], statementEnd[2], `20${statementEnd[3]}`) : "";
  if (through && !through.startsWith(`${month}-`)) return { through: "", rows: [] };

  const lines = text.split("\n");
  const amountPattern = new RegExp(`\\s+(${MONEY})(?=\\s|$)`);
  const rows = [];
  let date = "";
  let movementSection = false;
  for (const line of lines) {
    if (/Conta Corrente\s*\|\s*Movimenta|data\s+descri[cç][aã]o\s+entradas R\$/i.test(line)) movementSection = true;
    if (/Conta Corrente\s*\|\s*(?:Compras|Saques|Cheques)|Notas Explicativas\s*$/i.test(line)) movementSection = false;
    if (!movementSection) continue;
    const day = line.match(/^(\d{2})\/(\d{2})\s+/);
    if (day) date = fullDate(day[1], day[2], month.slice(0, 4));
    const entry = line.slice(day?.[0].length || 0).match(/\b(?:Sispag\s+)?PIX\b.*$/i)?.[0];
    if (!date.startsWith(`${month}-`) || !entry) continue;
    const amount = entry.match(amountPattern);
    if (!amount) continue;
    const value = cents(amount[1]);
    const description = entry.slice(0, amount.index).trim();
    const normalized = normalize(description);
    const incoming = /\bpix\s+(?:transf(?:erencia)?|receb(?:id[oa])?|cred(?:ito)?|qrs)\b/.test(normalized);
    const outgoing = /\bpix\s+(?:qr[ -]?code|enviad[oa]|pag(?:amento|o)?|transf)\b/.test(normalized);
    if ((value > 0 && !incoming) || (value < 0 && !outgoing) || !value) continue;
    rows.push({ date, description, value, pixId: pixId(entry) });
  }
  return { through, rows };
}

export function parseMercadoPagoCard(text, month) {
  const normalized = normalize(text);
  const due = normalized.match(/vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const issue = normalized.match(/emitida em:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const cut = normalized.indexOf("detalhes de consumo");
  const summary = cut >= 0 ? normalized.slice(0, cut).split("resumo da fatura")[1] : "";
  const total = summary?.match(/^total[ \t]+(r\$\s*[\d.]+,\d{2})/m);
  if (!normalized.includes("mercado pago") || !due || !issue || !total || cut < 0) {
    throw new Error("Selecione a fatura em PDF do cartao de credito Mercado Pago.");
  }
  const dueDate = fullDate(...due.slice(1));
  const issueDate = fullDate(...issue.slice(1));
  if (!dueDate.startsWith(`${month}-`)) {
    throw new Error("O vencimento da fatura deve estar no mes selecionado.");
  }
  const detail = text.slice(cut).split(/\n(?:Parcele a fatura|Seu cart[aã]o de cr[eé]dito)/i)[0];
  const purchasePattern = /^(\d{2}\/\d{2})\s+(.+?)\s+(R\$\s*-?[\d.]+,\d{2})$/gm;
  const purchases = [...detail.matchAll(purchasePattern)].map(([, date, description, value]) => ({
    date, description, value: cents(value) / 100
  }));
  const totalCents = cents(total[1]);
  const purchaseTotal = purchases.reduce((sum, row) => sum + Math.round(row.value * 100), 0);
  return { issueDate, dueDate, total: totalCents / 100, purchases, purchaseTotal: purchaseTotal / 100,
    difference: (totalCents - purchaseTotal) / 100 };
}

export function reconcileMercadoPago(accounts, itau, card) {
  const transfers = accounts.flatMap((account) => {
    if (!account.detailsVerified) return [];
    const debits = account.movements.filter(({ value, description }) =>
      value < 0 && /\b(?:pix|transferencia|retirada)\b/.test(normalize(description))
      && !/estorno|cancelad|fatura|devolucao|pagamento/.test(normalize(description)));
    const statements = itau.filter((bank) => bank.unitId === account.unitId);
    const credits = statements.flatMap((bank) => bank.rows.filter((row) => row.value > 0));
    const coverage = statements.map((bank) => bank.through).sort().at(-1) || "";
    const related = (debit, credit) => debit.value === -credit.value && (
      debit.pixId && debit.pixId === credit.pixId
      || debit.date === credit.date && (!debit.pixId || !credit.pixId)
    );
    return debits.map((debit) => {
      const matches = credits.filter((credit) => related(debit, credit));
      const credit = matches[0];
      const unique = matches.length === 1 && debits.filter((row) => related(row, credit)).length === 1;
      const identified = unique && (debit.pixId && debit.pixId === credit.pixId
        || /\bpix\s+(?:transf\w*|receb\w*|cred\w*)\b.*\bmercado\s*pag/.test(normalize(credit.description)));
      const status = identified ? "matched" : matches.length ? "review" : !coverage || debit.date > coverage ? "outside" : "pending";
      return { unitId: account.unitId, date: debit.date, amount: -debit.value / 100, status,
        candidates: matches.map(({ date, description }) => ({ date, description })) };
    });
  });
  const paymentCandidates = card?.total > 0 ? itau.flatMap((bank) => bank.rows
    .filter((row) => row.value === -Math.round(card.total * 100) && row.date >= card.issueDate)
    .map(({ date, description }) => ({ date, description, unitId: bank.unitId }))) : [];
  return { transfers, card: card ? { ...card, paymentCandidates, itauCount: itau.length } : null };
}
