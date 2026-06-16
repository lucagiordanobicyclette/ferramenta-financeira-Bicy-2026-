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
  packaging: "Embalagens",
  people: "Pessoal",
  occupancy: "Ocupacao",
  thirdParty: "Terceiros",
  nonOperational: "Nao operacional",
  publicity: "Publicidade",
  useAndConsumption: "Uso e consumo",
  operationalMaterial: "Material operacional",
  legal: "Legal / taxas"
};

const PACKAGING_PATTERNS = [
  "embalagens",
  "descartaveis",
  "descart√°veis"
];

const OPERATIONAL_MATERIAL_PATTERNS = [
  "uniformes",
  "utensilios",
  "utens√≠lios",
  "loucas",
  "lou√ßas",
  "limpeza",
  "material operacional",
  "material cestas",
  "material de apoio"
];

const FIXED_PROFIT_DISTRIBUTION = {
  barra: 15000,
  leblon: 15000,
  "jb-loja": 25000,
  "jb-delivery": 0
};

const UNIT_NAMES = {
  barra: "Barra",
  leblon: "Leblon",
  "jb-loja": "JB Loja",
  "jb-delivery": "JB Delivery"
};

const UNIT_CNPJS = {
  barra: "41265861000189",
  leblon: "43778192000174",
  "jb-loja": "07633835000128",
  "jb-delivery": "43778192000255"
};

const SOURCE_LABELS = {
  barra: "Relatorio Barra",
  leblon: "Relatorio Leblon",
  "jb-loja": "Relatorio JB Loja",
  "jb-delivery": "Relatorio JB Delivery Filial"
};

const COMPETENCE_REPORT_ENTRIES = [
  ["barra", "competence_report_barra"],
  ["leblon", "competence_report_leblon"],
  ["jb-loja", "competence_report_jb_loja"],
  ["jb-delivery", "competence_report_jb_delivery"]
];

const CASH_REPORT_ENTRIES = [
  ["barra", "cash_report_barra"],
  ["leblon", "cash_report_leblon"],
  ["jb-loja", "cash_report_jb_loja"],
  ["jb-delivery", "cash_report_jb_delivery"]
];

function parseMoney(raw) {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace("R$ ", "R$")
    .trim();
  const sign = cleaned.startsWith("-") || cleaned.split("R$").at(-1).includes("-") ? -1 : 1;
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

function onlyDigits(value) {
  return (value || "").replace(/\D+/g, "");
}

function inferUnitFromDocument(file, text) {
  const filename = normalizeText(file.name);
  const content = normalizeText(text || "");
  const digits = onlyDigits(text);

  const cnpjMatch = Object.entries(UNIT_CNPJS).find(([, cnpj]) => digits.includes(cnpj));
  if (cnpjMatch) {
    return cnpjMatch[0];
  }

  if (content.includes("jardim botanico dlv") || content.includes("delivery filial") || content.includes("43 778 192 0002 55")) {
    return "jb-delivery";
  }
  if (content.includes("jardim botanico") || content.includes("comercio de paes artesanais") || content.includes("07 633 835 0001 28")) {
    return "jb-loja";
  }
  if (content.includes("leblon") || content.includes("43 778 192 0001 74")) {
    return "leblon";
  }
  if (content.includes("barra") || content.includes("boulangerie") || content.includes("41 265 861 0001 89")) {
    return "barra";
  }

  if (filename.includes("delivery-filial") || filename.includes("jb-delivery")) {
    return "jb-delivery";
  }
  if (filename.includes("jb-loja") || (filename.includes("jb") && !filename.includes("delivery"))) {
    return "jb-loja";
  }
  if (filename.includes("leblon")) {
    return "leblon";
  }
  if (filename.includes("barra") || filename.includes("boulangerie") || filename.includes("bounagerie")) {
    return "barra";
  }

  return "";
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
  const seenCodes = new Set();

  const pushAccount = ({ code, name, level, revenue, expense, subtotal }) => {
    const value = code.startsWith("01")
      ? Math.abs(revenue || subtotal)
      : Math.abs(expense || subtotal || revenue);
    if (seenCodes.has(code) || value === 0 || Number.isNaN(value) || !level) return;
    seenCodes.add(code);

    accounts.push({
      code,
      name: cleanName(name || code),
      level,
      value: Number(value.toFixed(2)),
      revenueValue: Number(revenue.toFixed(2)),
      expenseValue: Number(expense.toFixed(2)),
      subtotalValue: Number(subtotal.toFixed(2))
    });
  };

  starts.forEach((start, startIndex) => {
    const code = start.match[1];
    const end = startIndex + 1 < starts.length ? starts[startIndex + 1].index : lines.length;
    const block = lines.slice(start.index, end);
    const segment = block.join("\n");
    const amounts = segment.match(/-?\s*R\$\s*[\d.]+,\d{2}/g) || [];
    const values = amounts.map(parseMoney);

    const inlineLevel = segment.match(/N√≠vel:\s*(\d+)/i);
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
      .replace(/\s*N√≠vel:.*$/i, "")
      .replace(/\s*-?\s*R\$\s*[\d.]+,\d{2}.*$/, "")
      .trim();

    const continuation = block.find((line, index) => {
      if (index === 0 || /R\$|N√≠vel:|about:blank|Portal Linx/i.test(line)) return false;
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

    pushAccount({
      code,
      name: namePart,
      level,
      revenue,
      expense,
      subtotal
    });
  });

  lines.forEach((line) => {
    const match = line.match(/^(0[12]\d*)\s+(.*)$/);
    if (!match) return;
    const code = match[1];
    if (code.length % 2 !== 0 || code.length > 12) return;

    const firstAmount = match[2].match(/-?\s*R\$\s*[\d.]+,\d{2}/);
    if (!firstAmount) return;
    const amounts = line.match(/-?\s*R\$\s*[\d.]+,\d{2}/g) || [];
    if (amounts.length < 2) return;
    const values = amounts.map(parseMoney);
    const revenue = values[0] || 0;
    const expense = values[1] || 0;
    const subtotal = values[2] || expense || revenue;
    const name = match[2].slice(0, firstAmount.index)
      .replace(/\s*%\/SEG.*$/i, "")
      .replace(/\s*%RT.*$/i, "")
      .trim() || (code === "0202" ? "Nao operacional" : code);

    pushAccount({
      code,
      name,
      level: code.length / 2,
      revenue,
      expense,
      subtotal
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

function classifyCmvAccount(account) {
  const name = normalizeText(account.name);
  if (PACKAGING_PATTERNS.some((pattern) => name.includes(normalizeText(pattern)))) {
    return "packaging";
  }
  if (OPERATIONAL_MATERIAL_PATTERNS.some((pattern) => name.includes(normalizeText(pattern)))) {
    return "operationalMaterial";
  }
  return "cmv";
}

function splitCmvRows(accounts) {
  const result = { cmv: [], packaging: [], operationalMaterial: [] };
  const root = accounts.find((account) => account.code === CATEGORY_ROOTS.cmv);
  if (!root) return result;

  immediateChildren(accounts, root.code).forEach((child) => {
    const children = immediateChildren(accounts, child.code);
    const childKind = classifyCmvAccount(child);
    if (children.length && childKind !== "packaging") {
      children.forEach((grandchild) => {
        result[classifyCmvAccount(grandchild)].push(rowTree(accounts, grandchild));
      });
    } else {
      result[childKind].push(rowTree(accounts, child));
    }
  });

  return result;
}

function rowTotal(rows) {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

function rowsToDetail(rows, group) {
  return rows.map((row) => ({
    group,
    name: row.name,
    value: row.value
  }));
}

function adjustedNonOperationalRows(accounts, unitId) {
  const rows = categoryRows(accounts, CATEGORY_ROOTS.nonOperational)
    .filter((row) => cleanName(row.name) !== "Distribuicao De Lucros");
  const fixedDistribution = FIXED_PROFIT_DISTRIBUTION[unitId] || 0;
  if (fixedDistribution) {
    rows.push({
      code: `fixed-profit-distribution-${unitId}`,
      name: "Distribuicao De Lucros",
      value: fixedDistribution
    });
  }
  return rows;
}

function detailRows(accounts, unitId) {
  const rows = [];
  const split = splitCmvRows(accounts);

  Object.entries(CATEGORY_ROOTS).forEach(([key, root]) => {
    if (key === "cmv") {
      rows.push(...rowsToDetail(split.cmv, GROUP_NAMES.cmv));
      rows.push(...rowsToDetail(split.packaging, GROUP_NAMES.packaging));
      rows.push(...rowsToDetail(split.operationalMaterial, GROUP_NAMES.operationalMaterial));
      return;
    }
    immediateChildren(accounts, root).forEach((account) => {
      if (key === "nonOperational" && cleanName(account.name) === "Distribuicao De Lucros") return;
      rows.push({
        group: GROUP_NAMES[key],
        name: account.name,
        value: account.value
      });
    });
  });

  ["publicity", "useAndConsumption", "operationalMaterial", "legal"].forEach((key) => {
    immediateChildren(accounts, EXTRA_CATEGORY_ROOTS[key]).forEach((account) => {
      rows.push({
        group: GROUP_NAMES[key],
        name: account.name,
        value: account.value
      });
    });
  });

  const fixedDistribution = FIXED_PROFIT_DISTRIBUTION[unitId] || 0;
  if (fixedDistribution) {
    rows.push({
      group: GROUP_NAMES.nonOperational,
      name: "Distribuicao De Lucros",
      value: fixedDistribution
    });
  }

  return rows;
}

function categoryDetails(accounts, unitId) {
  const split = splitCmvRows(accounts);
  const details = Object.fromEntries(
    Object.entries(CATEGORY_ROOTS).map(([key, root]) => [
      key,
      key === "cmv"
        ? split.cmv
        : key === "nonOperational"
          ? adjustedNonOperationalRows(accounts, unitId)
          : categoryRows(accounts, root)
    ])
  );
  details.packaging = split.packaging;
  details.operationalMaterial = [
    ...categoryRows(accounts, EXTRA_CATEGORY_ROOTS.operationalMaterial),
    ...split.operationalMaterial
  ];
  return details;
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
  const previous = text.match(/SALDO ANTERIOR\s+(-?[\d.]+,\d{2})/i);
  const totals = [...text.matchAll(/Total\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/gi)];
  const total = totals[0];
  if (!previous || !total) return null;
  return {
    openingBalance: parseMoney(`R$ ${previous[1]}`),
    credits: Math.abs(parseMoney(`R$ ${total[1]}`)),
    debits: Math.abs(parseMoney(`R$ ${total[2]}`)),
    closingBalance: parseMoney(`R$ ${total[3]}`),
    note: "Usado saldo da linha Total do extrato; Bradesco tambem mostra Invest Facil."
  };
}

function inferBankFile(file, text) {
  const filename = normalizeText(file.name);
  const combined = normalizeText(`${file.name}\n${text}`);
  const key = combined.replace(/[^a-z0-9]+/g, " ");
  const bank = combined.includes("bradesco")
    ? "Bradesco"
    : combined.includes("itau") || combined.includes("minha conta") && combined.includes("minha agencia")
      ? "Ita√∫"
      : "Banco";

  let unitId = "";
  let account = file.name.replace(/\.pdf$/i, "");
  const unitFromCnpj = inferUnitFromDocument(file, text);
  if (unitFromCnpj) {
    unitId = unitFromCnpj;
    account = UNIT_NAMES[unitId];
  } else if (filename.includes("delivery-filial") || filename.includes("jb-delivery") || key.includes("pacheco leao")) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (
    filename.includes("jb-loja")
    || (filename.includes("jb") && !filename.includes("delivery"))
    || key.includes("comercio de paes artesanais")
    || key.includes("com paes artesan")
    || key.includes("cnpj 007 633 835 0001 28")
  ) {
    unitId = "jb-loja";
    account = "JB Loja";
  } else if (
    filename.includes("leblon")
    || key.includes("ataulfo de paiva")
    || key.includes("loja b leblon")
    || key.includes("cnpj 043 778 192 0001 74")
  ) {
    unitId = "leblon";
    account = "Leblon";
  } else if (
    filename.includes("barra")
    || filename.includes("boulangerie")
    || filename.includes("bounagerie")
    || key.includes("erico verissimo")
    || key.includes("barra da tijuca")
    || key.includes("boulangerie bicyclette")
    || key.includes("cnpj 041 265 861 0001 89")
  ) {
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

function baseTotals(accounts) {
  const byCode = accountMap(accounts);
  const revenue = valueOf(byCode, "01") || valueOf(byCode, "0101") + valueOf(byCode, "0102");
  const expenses = valueOf(byCode, "02") || valueOf(byCode, "0201") + valueOf(byCode, "0202");
  const operational = valueOf(byCode, "0201");
  return { revenue, expenses, operational };
}

function baseCategories(accounts) {
  const byCode = accountMap(accounts);
  return {
    ...Object.fromEntries(Object.entries(CATEGORY_ROOTS).map(([key, root]) => [key, valueOf(byCode, root)])),
    ...Object.fromEntries(Object.entries(EXTRA_CATEGORY_ROOTS).map(([key, root]) => [key, valueOf(byCode, root)]))
  };
}

function applyProfitDistribution(unitId, expenses, categories) {
  const parsedDistribution = categories.profitDistribution || 0;
  const fixedDistribution = FIXED_PROFIT_DISTRIBUTION[unitId] ?? parsedDistribution;
  const distributionDelta = fixedDistribution - parsedDistribution;
  return {
    expenses: expenses + distributionDelta,
    categories: {
      ...categories,
      profitDistribution: fixedDistribution,
      nonOperational: (categories.nonOperational || 0) + distributionDelta
    }
  };
}

function normalizedProfitDistributionCategories(unitId, categories) {
  const parsedDistribution = categories.profitDistribution || 0;
  const fixedDistribution = FIXED_PROFIT_DISTRIBUTION[unitId] ?? parsedDistribution;
  if (!fixedDistribution || Math.abs(parsedDistribution - fixedDistribution) < 1) {
    return categories;
  }
  const distributionDelta = fixedDistribution - parsedDistribution;
  return {
    ...categories,
    profitDistribution: fixedDistribution,
    nonOperational: (categories.nonOperational || 0) + distributionDelta
  };
}

function buildUnit(month, unitId, competenceFile, competenceAccounts, cashFile, cashAccounts, bankAccounts) {
  const { revenue, operational } = baseTotals(competenceAccounts);
  const competenceTotals = baseTotals(competenceAccounts);
  const split = splitCmvRows(competenceAccounts);
  const distributionAdjusted = {
    expenses: competenceTotals.expenses,
    categories: normalizedProfitDistributionCategories(unitId, {
      ...baseCategories(competenceAccounts),
      cmv: rowTotal(split.cmv),
      packaging: rowTotal(split.packaging)
    })
  };
  const categories = {
    ...distributionAdjusted.categories,
    operationalMaterial: (distributionAdjusted.categories.operationalMaterial || 0) + rowTotal(split.operationalMaterial)
  };
  const expenses = distributionAdjusted.expenses;

  const cashTotals = baseTotals(cashAccounts || competenceAccounts);
  const cashRevenue = cashTotals.revenue;
  const cashExpenses = cashTotals.expenses;

  const variableItems = {
    cmv: categories.cmv || 0,
    packaging: categories.packaging || 0,
    taxes: categories.taxes || 0,
    commissions: categories.commissions || 0
  };

  return {
    id: unitId,
    name: UNIT_NAMES[unitId],
    month,
    source: competenceFile.name,
    cashSource: cashFile?.name || competenceFile.name,
    revenue: Number(revenue.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    operationalExpenses: Number(operational.toFixed(2)),
    realProfit: Number((revenue - expenses).toFixed(2)),
    cashRevenue: Number(cashRevenue.toFixed(2)),
    cashExpenses: Number(cashExpenses.toFixed(2)),
    cashResult: Number((cashRevenue - cashExpenses).toFixed(2)),
    categories: Object.fromEntries(
      Object.entries(categories)
        .filter(([, value]) => value)
        .map(([key, value]) => [key, Number(value.toFixed(2))])
    ),
    variableItems: Object.fromEntries(
      Object.entries(variableItems).map(([key, value]) => [key, Number(value.toFixed(2))])
    ),
    bankAccounts: bankAccounts[unitId] || [],
    detail: detailRows(competenceAccounts, unitId),
    revenueDetail: revenueRows(competenceAccounts),
    categoryDetails: categoryDetails(competenceAccounts, unitId)
  };
}

function reportTotals(accounts) {
  const totals = baseTotals(accounts);
  return {
    ...totals,
    lineCount: accounts.length
  };
}

function assertReadableReport(kind, unitId, file, accounts) {
  const totals = reportTotals(accounts);
  if (totals.lineCount >= 5 && (totals.revenue > 0 || totals.expenses > 0 || totals.operational > 0)) {
    return;
  }

  throw new Error(
    `Nao consegui ler os valores do PDF de ${kind} de ${UNIT_NAMES[unitId]} (${file.name}). ` +
    `O arquivo gerou ${totals.lineCount} linhas e totais zerados. ` +
    "Nada foi salvo; baixe novamente o relatorio do Linx em PDF texto e importe de novo."
  );
}

export async function buildFinancePackage({
  month,
  reportFiles,
  competenceReportFiles,
  cashReportFiles,
  bankFiles,
  pdfjsLib,
  onProgress
}) {
  const legacyReportFiles = reportFiles || {};
  const competenceEntries = COMPETENCE_REPORT_ENTRIES.map(([unitId, field]) => [
    unitId,
    competenceReportFiles?.[field] || legacyReportFiles[field.replace("competence_", "")]
  ]);
  const cashEntries = CASH_REPORT_ENTRIES.map(([unitId, field]) => [
    unitId,
    cashReportFiles?.[field] || legacyReportFiles[field.replace("cash_", "")]
  ]);

  const missing = [
    ...competenceEntries.filter(([, file]) => !file || file.size === 0).map(([unitId]) => `${SOURCE_LABELS[unitId]} de competencia`),
    ...cashEntries.filter(([, file]) => !file || file.size === 0).map(([unitId]) => `${SOURCE_LABELS[unitId]} de caixa`)
  ];
  if (missing.length) {
    throw new Error(`Faltam arquivos obrigatorios: ${missing.join(", ")}`);
  }

  const totalSteps = competenceEntries.length + cashEntries.length + bankFiles.length;
  let step = 0;
  const advance = (message) => {
    step += 1;
    onProgress?.(`${message} (${step}/${totalSteps})`);
  };

  const competenceData = {};
  for (const [fallbackUnitId, file] of competenceEntries) {
    const text = await extractPdfText(file, pdfjsLib);
    const unitId = inferUnitFromDocument(file, text) || fallbackUnitId;
    const accounts = parseAccounts(text);
    assertReadableReport("competencia", unitId, file, accounts);
    competenceData[unitId] = { file, accounts };
    advance(`Lendo competencia: ${SOURCE_LABELS[unitId]}`);
  }

  const cashData = {};
  for (const [fallbackUnitId, file] of cashEntries) {
    const text = await extractPdfText(file, pdfjsLib);
    const unitId = inferUnitFromDocument(file, text) || fallbackUnitId;
    const accounts = parseAccounts(text);
    assertReadableReport("caixa", unitId, file, accounts);
    cashData[unitId] = { file, accounts };
    advance(`Lendo caixa: ${SOURCE_LABELS[unitId]}`);
  }

  const missingAfterInference = Object.keys(UNIT_NAMES).filter((unitId) => !competenceData[unitId] || !cashData[unitId]);
  if (missingAfterInference.length) {
    throw new Error(`Nao consegui identificar todos os CNPJs dos relatorios: ${missingAfterInference.map((unitId) => UNIT_NAMES[unitId]).join(", ")}`);
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

  const units = Object.keys(UNIT_NAMES).map((unitId) =>
    buildUnit(
      month,
      unitId,
      competenceData[unitId].file,
      competenceData[unitId].accounts,
      cashData[unitId].file,
      cashData[unitId].accounts,
      bankAccounts
    )
  );

  const zeroUnits = units.filter((unit) => unit.revenue <= 0 || unit.expenses <= 0);
  if (zeroUnits.length) {
    throw new Error(
      `A importacao gerou valores zerados para: ${zeroUnits.map((unit) => unit.name).join(", ")}. ` +
      "Nada foi salvo; confira se os PDFs selecionados sao os relatorios completos por competencia e caixa."
    );
  }

  const hierarchy = Object.fromEntries(units.map((unit) => [
    unit.id,
    {
      revenueDetail: unit.revenueDetail,
      categoryDetails: unit.categoryDetails
    }
  ]));

  return {
    version: 3,
    importModel: "competence-cash-v3",
    type: "la-bicyclette-financeiro",
    month,
    dataset: {
      generatedAt: new Date().toISOString().slice(0, 10),
      months: [month],
      notes: [
        "Importacao feita no navegador a partir dos PDFs selecionados.",
        "Analise gerencial da parte superior feita pelos relatorios de competencia.",
        "Conferencia bancaria feita pelos relatorios de caixa comparados aos extratos reconhecidos pelo parser.",
        "Ponto de equilibrio estimado com CMV comida, embalagens/descartaveis, impostos e comissoes/tarifas como custos variaveis; motoboy fica em custos fixos."
      ],
      units
    },
    hierarchy
  };
}
