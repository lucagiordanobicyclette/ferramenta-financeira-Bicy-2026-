const CATEGORY_ROOTS = {
  commissions: "020101",
  taxes: "020102",
  cmv: "020104",
  people: "020105",
  occupancy: "020106",
  thirdParty: "020107",
  nonOperational: "0202"
};

const EXTRA_CATEGORY_ROOTS = {
  publicity: "020108",
  useAndConsumption: "020109",
  operationalMaterial: "020110",
  legal: "020113",
  investments: "020201",
  profitDistribution: "020202"
};

const GROUP_NAMES = {
  commissions: "Comissoes",
  taxes: "Impostos",
  cmv: "CMV",
  people: "Pessoal",
  occupancy: "Ocupacao",
  thirdParty: "Terceiros",
  nonOperational: "Nao operacional"
};

const UNIT_NAMES = {
  barra: "Barra",
  leblon: "Leblon",
  "jb-loja": "JB Loja",
  "jb-delivery": "JB Delivery"
};

const SOURCE_LABELS = {
  barra: "Relatorio Barra",
  leblon: "Relatorio Leblon",
  "jb-loja": "Relatorio JB Loja",
  "jb-delivery": "Relatorio JB Delivery Filial"
};

function parseMoney(raw) {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace("R$ ", "R$")
    .trim();
  const sign = cleaned.startsWith("-") ? -1 : 1;
  const number = cleaned.replace("-", "").replace("R$", "");
  return sign * Number(number);
}

function cleanName(raw) {
  return raw.replace(/\n/g, " ").split(/\s+/).filter(Boolean).join(" ").toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function normalizeText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function extractPdfText(file, pdfjsLib) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();

    content.items.forEach((item) => {
      if (!item.str?.trim()) return;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / 2) * 2;
      const row = rows.get(y) || [];
      row.push({ x, text: item.str });
      rows.set(y, row);
    });

    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim())
      .filter(Boolean);
    pages.push(lines.join("\n"));
  }

  return pages.join("\n");
}

function parseAccounts(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const starts = lines
    .map((line, index) => ({ line, index, match: line.match(/^(\d{2,})\s*-\s*(.*)$/) }))
    .filter((item) => item.match);
  const accounts = [];

  starts.forEach((start, startIndex) => {
    const code = start.match[1];
    const end = startIndex + 1 < starts.length ? starts[startIndex + 1].index : lines.length;
    const block = lines.slice(start.index, end);
    const segment = block.join("\n");
    const amounts = segment.match(/-?\s*R\$\s*[\d.]+,\d{2}/g) || [];
    const values = amounts.map(parseMoney);

    const inlineLevel = segment.match(/Nível:\s*(\d+)/i);
    const levelLine = block.find((line, index) => index > 0 && /^\d+\b/.test(line));
    const trailingLevelLine = block.find((line, index) => {
      if (index === 0 || /R\$/.test(line)) return false;
      return /\s\d+$/.test(line);
    });
    const level = Number(
      inlineLevel?.[1]
      || levelLine?.match(/^(\d+)\b/)?.[1]
      || trailingLevelLine?.match(/(\d+)$/)?.[1]
      || 0
    );

    let namePart = start.match[2]
      .replace(/\s*Nível:.*$/i, "")
      .replace(/\s*-?\s*R\$\s*[\d.]+,\d{2}.*$/, "")
      .trim();

    const continuation = block.find((line, index) => {
      if (index === 0 || /R\$|Nível:|about:blank|Portal Linx/i.test(line)) return false;
      if (/^\d+\b/.test(line)) return false;
      return /\D/.test(line);
    });
    if (continuation) {
      namePart = `${namePart} ${continuation.replace(/\s+\d+$/, "")}`.trim();
    }

    let revenue = 0;
    let expense = 0;
    let subtotal = 0;
    if (values.length >= 3) {
      [revenue, expense, subtotal] = values;
    } else if (values.length) {
      [expense, subtotal] = [values[0], values[0]];
    }

    const value = Math.abs(subtotal || expense || revenue);
    if (value === 0 || Number.isNaN(value) || !level) return;

    accounts.push({
      code,
      name: cleanName(namePart),
      level,
      value: Number(value.toFixed(2))
    });
  });

  return accounts;
}

function accountMap(accounts) {
  return accounts.reduce((map, account) => {
    map[account.code] = account;
    return map;
  }, {});
}

function valueOf(accountsByCode, code) {
  return accountsByCode[code]?.value || 0;
}

function descendants(accounts, prefix) {
  return accounts.filter((account) => account.code.startsWith(prefix) && account.code !== prefix);
}

function immediateChildren(accounts, prefix) {
  const parent = accounts.find((account) => account.code === prefix);
  if (!parent) return [];
  return accounts.filter((account) =>
    account.code.startsWith(prefix)
    && account.code !== prefix
    && account.level === parent.level + 1
  );
}

function rowTree(accounts, account) {
  const children = immediateChildren(accounts, account.code);
  const row = {
    code: account.code,
    name: account.name,
    value: account.value
  };
  if (children.length) {
    row.children = children.map((child) => rowTree(accounts, child));
  }
  return row;
}

function categoryRows(accounts, rootCode) {
  const root = accounts.find((account) => account.code === rootCode);
  return root ? immediateChildren(accounts, rootCode).map((child) => rowTree(accounts, child)) : [];
}

function revenueRows(accounts) {
  const root = accounts.find((account) => account.code === "0101");
  return root ? immediateChildren(accounts, "0101").map((child) => rowTree(accounts, child)) : [];
}

function detailRows(accounts) {
  return Object.entries(CATEGORY_ROOTS).flatMap(([key, root]) => {
    const group = GROUP_NAMES[key];
    return immediateChildren(accounts, root).map((account) => ({
      group,
      name: account.name,
      value: account.value
    }));
  });
}

function parseItauBank(text) {
  const opening = text.match(/saldo em \d{2}\/\d{2}\/\d{2}[\s\S]*?R\$ ([\d.]+,\d{2})/i);
  const closing = text.match(/saldo em 31\/\d{2}\/\d{2}[\s\S]*?R\$ [\d.]+,\d{2}\s*R\$ ([\d.]+,\d{2})/i);
  const totals = text.match(/total\s+entradas[\s\S]*?R\$ ([\d.]+,\d{2})\s*R\$ ([\d.]+,\d{2})/i);
  if (!opening || !closing || !totals) return null;
  return {
    openingBalance: parseMoney(`R$ ${opening[1]}`),
    credits: parseMoney(`R$ ${totals[1]}`),
    debits: parseMoney(`R$ ${totals[2]}`),
    closingBalance: parseMoney(`R$ ${closing[1]}`)
  };
}

function parseBradescoBank(text) {
  const previous = text.match(/SALDO ANTERIOR\s+([\d.]+,\d{2})/i);
  const total = text.match(/Total\s+([\d.]+,\d{2})\s+-?([\d.]+,\d{2})\s+([\d.]+,\d{2})/i);
  if (!previous || !total) return null;
  return {
    openingBalance: parseMoney(`R$ ${previous[1]}`),
    credits: parseMoney(`R$ ${total[1]}`),
    debits: parseMoney(`R$ ${total[2]}`),
    closingBalance: parseMoney(`R$ ${total[3]}`),
    note: "Usado saldo da linha Total do extrato; Bradesco tambem mostra Invest Facil."
  };
}

function inferBankFile(file, text) {
  const filename = normalizeText(file.name);
  const combined = normalizeText(`${file.name}\n${text}`);
  const bank = combined.includes("bradesco") ? "Bradesco" : combined.includes("itau") ? "Itaú" : "Banco";

  let unitId = "";
  let account = file.name.replace(/\.pdf$/i, "");
  if (filename.includes("delivery-filial") || filename.includes("jb-delivery")) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (filename.includes("jb-loja") || (filename.includes("jb") && !filename.includes("delivery"))) {
    unitId = "jb-loja";
    account = "JB Loja";
  } else if (filename.includes("leblon")) {
    unitId = "leblon";
    account = "Leblon";
  } else if (filename.includes("barra") || filename.includes("boulangerie")) {
    unitId = "barra";
    account = "Barra";
  } else if (combined.includes("delivery filial") || combined.includes("jb delivery") || combined.includes("jardim botanico - dlv")) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (combined.includes("jb loja") || combined.includes("jardim botanico")) {
    unitId = "jb-loja";
    account = "JB Loja";
  } else if (combined.includes("leblon")) {
    unitId = "leblon";
    account = "Leblon";
  } else if (combined.includes("barra") || combined.includes("boulangerie")) {
    unitId = "barra";
    account = "Barra";
  }

  return { bank, unitId, account };
}

function parseBankAccount(file, text) {
  const { bank, unitId, account } = inferBankFile(file, text);
  const parsed = bank === "Bradesco" ? parseBradescoBank(text) : parseItauBank(text);
  if (!parsed || !unitId) return null;
  return {
    ...parsed,
    bank,
    account,
    source: file.name
  };
}

function buildUnit(month, unitId, file, accounts, bankAccounts) {
  const byCode = accountMap(accounts);
  const revenue = valueOf(byCode, "01") || valueOf(byCode, "0101") + valueOf(byCode, "0102");
  const expenses = valueOf(byCode, "02") || valueOf(byCode, "0201") + valueOf(byCode, "0202");
  const operational = valueOf(byCode, "0201");

  const categories = {
    ...Object.fromEntries(Object.entries(CATEGORY_ROOTS).map(([key, root]) => [key, valueOf(byCode, root)])),
    ...Object.fromEntries(Object.entries(EXTRA_CATEGORY_ROOTS).map(([key, root]) => [key, valueOf(byCode, root)]))
  };

  const variableItems = {
    cmv: categories.cmv || 0,
    taxes: categories.taxes || 0,
    commissions: categories.commissions || 0
  };

  return {
    id: unitId,
    name: UNIT_NAMES[unitId],
    month,
    source: file.name,
    revenue: Number(revenue.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    operationalExpenses: Number(operational.toFixed(2)),
    realProfit: Number((revenue - expenses).toFixed(2)),
    categories: Object.fromEntries(
      Object.entries(categories)
        .filter(([, value]) => value)
        .map(([key, value]) => [key, Number(value.toFixed(2))])
    ),
    variableItems: Object.fromEntries(
      Object.entries(variableItems).map(([key, value]) => [key, Number(value.toFixed(2))])
    ),
    bankAccounts: bankAccounts[unitId] || [],
    detail: detailRows(accounts),
    revenueDetail: revenueRows(accounts),
    categoryDetails: Object.fromEntries(
      Object.entries(CATEGORY_ROOTS).map(([key, root]) => [key, categoryRows(accounts, root)])
    )
  };
}

export async function buildFinancePackage({ month, reportFiles, bankFiles, pdfjsLib, onProgress }) {
  const reportEntries = [
    ["barra", reportFiles.report_barra],
    ["leblon", reportFiles.report_leblon],
    ["jb-loja", reportFiles.report_jb_loja],
    ["jb-delivery", reportFiles.report_jb_delivery]
  ];

  const totalSteps = reportEntries.length + bankFiles.length;
  let step = 0;
  const advance = (message) => {
    step += 1;
    onProgress?.(`${message} (${step}/${totalSteps})`);
  };

  const reportData = {};
  for (const [unitId, file] of reportEntries) {
    const text = await extractPdfText(file, pdfjsLib);
    reportData[unitId] = { file, accounts: parseAccounts(text) };
    advance(`Lendo ${SOURCE_LABELS[unitId]}`);
  }

  const bankAccounts = Object.fromEntries(Object.keys(UNIT_NAMES).map((unitId) => [unitId, []]));
  for (const file of bankFiles) {
    const text = await extractPdfText(file, pdfjsLib);
    const parsed = parseBankAccount(file, text);
    if (parsed) {
      const { unitId } = inferBankFile(file, text);
      bankAccounts[unitId].push(parsed);
    }
    advance(`Lendo extrato ${file.name}`);
  }

  const units = reportEntries.map(([unitId]) =>
    buildUnit(month, unitId, reportData[unitId].file, reportData[unitId].accounts, bankAccounts)
  );

  const hierarchy = Object.fromEntries(units.map((unit) => [
    unit.id,
    {
      revenueDetail: unit.revenueDetail,
      categoryDetails: unit.categoryDetails
    }
  ]));

  return {
    version: 1,
    type: "la-bicyclette-financeiro",
    month,
    dataset: {
      generatedAt: new Date().toISOString().slice(0, 10),
      months: [month],
      notes: [
        "Importacao feita no navegador a partir dos PDFs selecionados.",
        "Ponto de equilibrio estimado com CMV, impostos e comissoes/tarifas como custos variaveis; motoboy fica em custos fixos.",
        "Conferencia bancaria importada dos extratos quando reconhecidos pelo parser."
      ],
      units
    },
    hierarchy
  };
}
