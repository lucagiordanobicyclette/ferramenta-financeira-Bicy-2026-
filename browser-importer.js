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
  "descartáveis"
];

const OPERATIONAL_MATERIAL_PATTERNS = [
  "uniformes",
  "utensilios",
  "utensílios",
  "loucas",
  "louças",
  "limpeza",
  "material operacional",
  "material cestas",
  "material de apoio"
];

const ACCOUNT_NAME_OVERRIDES = {
  "01": "Receitas",
  "0101": "Receita operacional",
  "0102": "Receita nao operacional",
  "02": "Despesas",
  "0201": "Despesas operacionais",
  "020101": "Tarifas bancarias e taxas",
  "020102": "Impostos",
  "020104": "CMV",
  "020105": "Despesas pessoal",
  "020106": "Ocupacao",
  "020107": "Servicos de terceiros",
  "020108": "Publicidade",
  "020109": "Uso e consumo",
  "020110": "Material operacional",
  "020113": "Legal / taxas",
  "0202": "Nao operacional",
  "020201": "Investimentos",
  "020202": "Distribuicao de lucros"
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

const SPREADSHEET_EXTENSIONS = [".xlsx", ".xls", ".csv"];

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

function isSpreadsheetFile(file) {
  const name = normalizeText(file.name || "");
  return SPREADSHEET_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isPdfFile(file) {
  return normalizeText(file.name || "").endsWith(".pdf") || file.type === "application/pdf";
}

function ptMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function restoreAccountCode(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("1") || digits.startsWith("2")) {
    const padded = `0${digits}`;
    return padded.length % 2 === 0 ? padded : digits;
  }
  return digits;
}

function cleanName(raw) {
  return raw.replace(/\n/g, " ").split(/\s+/).filter(Boolean).join(" ").toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function accountDisplayName(name, code) {
  const cleaned = cleanName(name || "");
  const onlyCode = /^\d+$/.test(cleaned.replace(/\s+/g, ""));
  if (cleaned && !onlyCode) return cleaned;

  for (let size = code.length; size >= 2; size -= 2) {
    const fallback = ACCOUNT_NAME_OVERRIDES[code.slice(0, size)];
    if (fallback) return fallback;
  }

  return "Sem descricao";
}

function isAccountNameContinuation(line) {
  if (!line || /R\$|Nível:|about:blank|Portal Linx|^\d{2,}\b/i.test(line)) {
    return false;
  }
  return /\D/.test(line);
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

  if (
    content.includes("jardim botanico dlv")
    || content.includes("delivery filial")
    || content.includes("la bicyclette delivery ltda")
    || content.includes("pacheco leao")
    || content.includes("minha conta99895")
    || content.includes("cc 99895")
    || content.includes("43 778 192 0002 55")
  ) {
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

let tesseractPromise = null;
let sheetJsPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;

  tesseractPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("Nao consegui carregar o OCR para ler PDF em imagem. Exporte o relatorio do Linx como PDF textual ou Excel."));
    document.head.appendChild(script);
  });

  return tesseractPromise;
}

function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJsPromise) return sheetJsPromise;

  sheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Nao consegui carregar o leitor de Excel. Tente novamente com internet ativa ou exporte o relatorio em PDF textual."));
    document.head.appendChild(script);
  });

  return sheetJsPromise;
}

async function ocrPdfPages(pdf, file, onProgress) {
  if (typeof document === "undefined") return "";
  const Tesseract = await loadTesseract();
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`OCR em ${file.name}: pagina ${pageNumber}/${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await Tesseract.recognize(canvas, "por+eng");
    pages.push(result.data?.text || "");
  }

  return pages.join("\n");
}

async function extractPdfText(file, pdfjsLib, onProgress) {
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

  const extracted = pages.join("\n");
  if (extracted.replace(/\s+/g, "").length > 80) {
    return extracted;
  }

  onProgress?.(`${file.name} parece PDF em imagem; tentando OCR`);
  const ocrText = await ocrPdfPages(pdf, file, onProgress);
  return ocrText || extracted;
}

function formatSpreadsheetCell(value, index) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toLocaleDateString("pt-BR");

  if (typeof value === "number") {
    if (index === 0) return restoreAccountCode(value);
    if (index === 1 && Number.isInteger(value) && value > 0 && value < 20) return `Nível: ${value}`;
    return ptMoney(value);
  }

  const raw = String(value).replace(/\u00a0/g, " ").trim();
  if (!raw) return "";
  if (index === 0 && /^\d+$/.test(raw)) return restoreAccountCode(raw);
  if (index === 1 && /^\d+$/.test(raw) && Number(raw) > 0 && Number(raw) < 20) return `Nível: ${raw}`;
  if (index >= 2 && /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(raw)) return `R$ ${raw}`;
  if (index >= 2 && /^-?\d+([.,]\d+)?$/.test(raw)) return ptMoney(Number(raw.replace(/\./g, "").replace(",", ".")));
  return raw;
}

async function extractSpreadsheetText(file, onProgress) {
  const XLSX = await loadSheetJs();
  onProgress?.(`Lendo planilha: ${file.name}`);
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const lines = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    lines.push(`Aba ${sheetName}`);
    rows.forEach((row) => {
      const cells = row.map((cell, index) => formatSpreadsheetCell(cell, index)).filter(Boolean);
      if (cells.length) lines.push(cells.join(" "));
    });
  });

  return lines.join("\n");
}

async function extractReportText(file, pdfjsLib, onProgress) {
  if (isSpreadsheetFile(file)) return extractSpreadsheetText(file, onProgress);
  if (isPdfFile(file)) return extractPdfText(file, pdfjsLib, onProgress);
  throw new Error(`Formato nao suportado em ${file.name}. Use Excel, CSV ou PDF.`);
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
      name: accountDisplayName(name, code),
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

    const continuation = block.find((line, index) => index > 0 && isAccountNameContinuation(line));
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

  lines.forEach((line, index) => {
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
    let name = match[2].slice(0, firstAmount.index)
      .replace(/\s*%\/SEG.*$/i, "")
      .replace(/\s*%RT.*$/i, "")
      .trim();
    if (!name) {
      const previous = isAccountNameContinuation(lines[index - 1]) ? lines[index - 1].replace(/\s+\d+$/, "").trim() : "";
      const next = isAccountNameContinuation(lines[index + 1]) ? lines[index + 1].replace(/\s+\d+$/, "").trim() : "";
      name = `${previous} ${next}`.trim();
    }

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

function isProfitDistributionAccount(account) {
  const normalized = normalizeText(account.name)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    account.code === EXTRA_CATEGORY_ROOTS.profitDistribution
    || normalized.includes("distribuicao de lucro")
    || normalized.includes("distribuicao lucros")
    || normalized.includes("distrib lucros")
    || normalized.includes("dist de lucro")
    || normalized.includes("dist lucro")
  );
}

function parsedProfitDistribution(accounts, byCode) {
  const byRoot = valueOf(byCode, EXTRA_CATEGORY_ROOTS.profitDistribution);
  if (byRoot) return byRoot;

  return accounts
    .filter(isProfitDistributionAccount)
    .filter((account) => !accounts.some((candidate) =>
      candidate.code !== account.code
      && account.code.startsWith(candidate.code)
      && isProfitDistributionAccount(candidate)
    ))
    .reduce((sum, account) => sum + account.value, 0);
}

function detailRows(accounts, unitId) {
  const rows = [];
  const split = splitCmvRows(accounts);

  Object.entries(CATEGORY_ROOTS).forEach(([key, root]) => {
    if (key === "cmv") {
      rows.push(...rowsToDetail(split.cmv, GROUP_NAMES.cmv));
      rows.push(...rowsToDetail(split.packaging, GROUP_NAMES.cmv));
      rows.push(...rowsToDetail(split.operationalMaterial, GROUP_NAMES.operationalMaterial));
      return;
    }
    immediateChildren(accounts, root).forEach((account) => {
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

  return rows;
}

function categoryDetails(accounts, unitId) {
  const split = splitCmvRows(accounts);
  const details = Object.fromEntries(
    Object.entries(CATEGORY_ROOTS).map(([key, root]) => [
      key,
      key === "cmv"
        ? split.cmv
        : categoryRows(accounts, root)
    ])
  );
  details.cmv = [
    ...split.cmv,
    ...split.packaging
  ];
  details.packaging = [];
  details.operationalMaterial = [
    ...categoryRows(accounts, EXTRA_CATEGORY_ROOTS.operationalMaterial),
    ...split.operationalMaterial
  ];
  return details;
}

function parseItauBank(text) {
  const compactText = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n");
  const moneyPattern = "R?\\$?\\s*(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}|-?\\d+,\\d{2})";
  const moneyRegex = new RegExp(moneyPattern, "gi");
  const moneyNear = (pattern, pick = "first") => {
    const match = compactText.match(pattern);
    if (!match) return "";
    const values = [...match[0].matchAll(new RegExp(moneyPattern, "gi"))].map((item) => item[1]);
    return pick === "last" ? values.at(-1) || "" : values[0] || "";
  };
  const balancePair = compactText.match(new RegExp(`saldo em \\d{2}\\/\\d{2}\\/\\d{2}\\s+saldo em \\d{2}\\/\\d{2}\\/\\d{2}[\\s\\S]*?${moneyPattern}\\s+${moneyPattern}`, "i"));
  const opening = balancePair?.[1]
    || compactText.match(new RegExp(`saldo anterior[\\s\\S]{0,120}?${moneyPattern}`, "i"))?.[1]
    || compactText.match(new RegExp(`saldo em \\d{2}\\/\\d{2}\\/\\d{2}[\\s\\S]{0,120}?${moneyPattern}`, "i"))?.[1];
  const closing = balancePair?.[2]
    || compactText.match(new RegExp(`saldo final[\\s\\S]{0,120}?${moneyPattern}`, "i"))?.[1]
    || moneyNear(/saldo em \d{2}\/\d{2}\/\d{2}[\s\S]{0,220}/i, "last");
  const totalPair = compactText.match(new RegExp(`total\\s*entradas\\s+total\\s*sa[ií]das[\\s\\S]*?${moneyPattern}\\s+${moneyPattern}`, "i"));
  const credits = totalPair?.[1]
    || moneyNear(/entradas\s*\(cr[eé]ditos\)[\s\S]{0,500}?\btotal[\s\S]{0,120}/i, "last")
    || moneyNear(/total\s+(?:de\s+)?entradas[\s\S]{0,160}/i)
    || moneyNear(/entradas[\s\S]{0,120}/i, "last");
  const debits = totalPair?.[2]
    || moneyNear(/sa[ií]das\s*\(d[eé]bitos\)[\s\S]{0,500}?\btotal[\s\S]{0,120}/i, "last")
    || moneyNear(/total\s+(?:de\s+)?sa[ií]das[\s\S]{0,160}/i)
    || moneyNear(/sa[ií]das[\s\S]{0,120}/i, "last");
  if (!opening || !closing || !credits || !debits) return null;
  return {
    openingBalance: parseMoney(opening),
    credits: Math.abs(parseMoney(credits)),
    debits: Math.abs(parseMoney(debits)),
    closingBalance: parseMoney(closing)
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
  const digits = onlyDigits(text);
  const bank = combined.includes("bradesco")
    ? "Bradesco"
    : combined.includes("itau") || combined.includes("minha conta") && combined.includes("minha agencia")
      ? "Itaú"
      : "Banco";

  let unitId = "";
  let account = file.name.replace(/\.pdf$/i, "");

  if (
    filename.includes("delivery filial")
    || filename.includes("delivery-filial")
    || filename.includes("jb delivery")
    || filename.includes("jb-delivery")
    || filename.includes("delivery jb")
  ) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (filename.includes("leblon")) {
    unitId = "leblon";
    account = "Leblon";
  } else if (
    filename.includes("barra")
    || filename.includes("boulangerie")
    || filename.includes("bounagerie")
  ) {
    unitId = "barra";
    account = "Barra";
  } else if (
    filename.includes("jb-loja")
    || filename.includes("jb loja")
    || (filename.includes("jb") && !filename.includes("delivery"))
  ) {
    unitId = "jb-loja";
    account = "JB Loja";
  }

  const unitFromCnpj = Object.entries(UNIT_CNPJS).find(([, cnpj]) => digits.includes(cnpj))?.[0] || "";
  if (!unitId && unitFromCnpj) {
    unitId = unitFromCnpj;
    account = UNIT_NAMES[unitId];
  } else if (
    !unitId
    && (key.includes("la bicyclette delivery ltda") && key.includes("pacheco leao"))
  ) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (
    !unitId
    && (key.includes("avenida ataulfo de paiva")
    || key.includes("loja b leblon")
    || key.includes("cnpj 043 778 192 0001 74"))
  ) {
    unitId = "leblon";
    account = "Leblon";
  } else if (
    !unitId
    && (key.includes("erico verissimo")
    || key.includes("barra da tijuca")
    || key.includes("boulangerie bicyclette")
    || key.includes("cnpj 041 265 861 0001 89"))
  ) {
    unitId = "barra";
    account = "Barra";
  } else if (
    !unitId
    && (key.includes("comercio de paes artesanais")
    || key.includes("com paes artesan")
    || key.includes("cnpj 007 633 835 0001 28"))
  ) {
    unitId = "jb-loja";
    account = "JB Loja";
  } else if (!unitId && (combined.includes("delivery filial") || combined.includes("jb delivery") || combined.includes("jardim botanico - dlv"))) {
    unitId = "jb-delivery";
    account = "JB Delivery";
  } else if (!unitId && (combined.includes("jb loja") || combined.includes("jardim botanico"))) {
    unitId = "jb-loja";
    account = "JB Loja";
  } else if (!unitId && combined.includes("leblon")) {
    unitId = "leblon";
    account = "Leblon";
  } else if (!unitId && (combined.includes("barra") || combined.includes("boulangerie"))) {
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
    unitId,
    unitName: UNIT_NAMES[unitId],
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
    ...Object.fromEntries(Object.entries(EXTRA_CATEGORY_ROOTS).map(([key, root]) => [key, valueOf(byCode, root)])),
    profitDistribution: parsedProfitDistribution(accounts, byCode)
  };
}

function buildUnit(month, unitId, competenceFile, competenceAccounts, cashFile, cashAccounts, bankAccounts) {
  const { revenue, operational } = baseTotals(competenceAccounts);
  const competenceTotals = baseTotals(competenceAccounts);
  const split = splitCmvRows(competenceAccounts);
  const parsedCategories = {
    ...baseCategories(competenceAccounts),
    cmv: rowTotal(split.cmv) + rowTotal(split.packaging),
    packaging: 0
  };
  const categories = {
    ...parsedCategories,
    operationalMaterial: (parsedCategories.operationalMaterial || 0) + rowTotal(split.operationalMaterial)
  };
  const expenses = competenceTotals.expenses;

  const cashTotals = baseTotals(cashAccounts || competenceAccounts);
  const cashRevenue = cashTotals.revenue;
  const cashExpenses = cashTotals.expenses;

  const variableItems = {
    cmv: categories.cmv || 0,
    packaging: 0,
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
    const text = await extractReportText(file, pdfjsLib, onProgress);
    const unitId = fallbackUnitId;
    const accounts = parseAccounts(text);
    assertReadableReport("competencia", unitId, file, accounts);
    competenceData[unitId] = {
      file,
      accounts,
      detectedUnitId: inferUnitFromDocument(file, text) || ""
    };
    advance(`Lendo competencia: ${SOURCE_LABELS[unitId]}`);
  }

  const cashData = {};
  for (const [fallbackUnitId, file] of cashEntries) {
    const text = await extractReportText(file, pdfjsLib, onProgress);
    const unitId = fallbackUnitId;
    const accounts = parseAccounts(text);
    assertReadableReport("caixa", unitId, file, accounts);
    cashData[unitId] = {
      file,
      accounts,
      detectedUnitId: inferUnitFromDocument(file, text) || ""
    };
    advance(`Lendo caixa: ${SOURCE_LABELS[unitId]}`);
  }

  const missingAfterInference = Object.keys(UNIT_NAMES).filter((unitId) => !competenceData[unitId] || !cashData[unitId]);
  if (missingAfterInference.length) {
    throw new Error(`Faltam relatorios obrigatorios para: ${missingAfterInference.map((unitId) => UNIT_NAMES[unitId]).join(", ")}`);
  }

  const bankAccounts = Object.fromEntries(Object.keys(UNIT_NAMES).map((unitId) => [unitId, []]));
  const ignoredBankFiles = [];
  for (const file of bankFiles) {
    const text = await extractPdfText(file, pdfjsLib, onProgress);
    const parsed = parseBankAccount(file, text);
    if (parsed) {
      bankAccounts[parsed.unitId].push(parsed);
    } else {
      const inferred = inferBankFile(file, text);
      ignoredBankFiles.push({
        source: file.name,
        bank: inferred.bank,
        unitId: inferred.unitId,
        unitName: inferred.unitId ? UNIT_NAMES[inferred.unitId] : "",
        reason: inferred.unitId
          ? "Nao consegui ler saldos, entradas e saidas do extrato."
          : "Nao consegui identificar a unidade do extrato."
      });
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
        "Ponto de equilibrio estimado com CMV, impostos e comissoes/tarifas como custos variaveis; CMV inclui comida, embalagens e descartaveis. Motoboy fica em custos fixos."
      ],
      ignoredBankFiles,
      units
    },
    hierarchy
  };
}
