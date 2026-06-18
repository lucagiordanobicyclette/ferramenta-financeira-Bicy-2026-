const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const pct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1
});

const labels = {
  revenue: "Faturamento",
  expenses: "Despesas",
  operationalExpenses: "Despesas operacionais",
  realProfit: "Lucro real",
  cmv: "CMV comida",
  packaging: "Embalagens/descartaveis",
  taxes: "Impostos",
  people: "Pessoal",
  occupancy: "Ocupacao",
  commissions: "Comissoes e tarifas",
  thirdParty: "Servicos de terceiros",
  nonOperational: "Nao operacional",
  publicity: "Publicidade",
  useAndConsumption: "Uso e consumo",
  operationalMaterial: "Material operacional",
  legal: "Legal / taxas"
};

const palette = ["#3fd18b", "#5f9cff", "#f2b84b", "#f26d5b", "#39c5c8", "#a887ff", "#f08a55", "#aab4c3"];
const neutral = "#d7dce0";
const variableCostKeys = ["cmv", "packaging", "taxes", "commissions"];

const state = {
  selected: "all",
  activeCostCategory: "cmv",
  activeCostSubcategory: null,
  costDrillPath: [],
  activeSummaryMetric: null,
  comparisonPackages: []
};

const views = {
  all: {
    id: "grupo",
    name: "Grupo",
    unitIds: ["barra", "leblon", "jb-loja", "jb-delivery"]
  },
  "barra-leblon": {
    id: "barra-leblon",
    name: "Barra + Leblon",
    unitIds: ["barra", "leblon"]
  },
  barra: {
    id: "barra",
    name: "Barra",
    unitIds: ["barra"]
  },
  leblon: {
    id: "leblon",
    name: "Leblon",
    unitIds: ["leblon"]
  },
  jb: {
    id: "jb",
    name: "JB",
    unitIds: ["jb-loja", "jb-delivery"]
  }
};

function variableCost(unit) {
  return variableCostKeys.reduce((sum, key) => sum + (unit.variableItems[key] || 0), 0);
}

function normalizedText(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function profitDistribution(unit) {
  return unit.categories.profitDistribution || 0;
}

function displayRevenue(unit) {
  return unit.revenue;
}

function displayExpenses(unit) {
  return unit.expenses;
}

function displayProfit(unit) {
  return displayRevenue(unit) - displayExpenses(unit);
}

function displayCashResult(unit) {
  return unit.cashResult ?? unit.realProfit ?? displayProfit(unit);
}

function fixedCost(unit) {
  return unit.operationalExpenses - variableCost(unit);
}

function variableCostRows(unit) {
  const rows = [...unit.detail]
    .filter((item) => {
      return item.group === "CMV"
        || item.group === "Embalagens"
        || item.group === "Impostos"
        || item.group === "Comissoes";
    })
    .reduce((map, item) => {
      const name = `${item.group}: ${normalizeDetailName(item.group, item.name)}`;
      const current = map.get(name) || { name, value: 0 };
      current.value += item.value;
      map.set(name, current);
      return map;
    }, new Map());

  const visibleRows = [...rows.values()];
  const visibleTotal = visibleRows.reduce((sum, row) => sum + row.value, 0);
  const gap = variableCost(unit) - visibleTotal;
  if (Math.abs(gap) > 1) {
    visibleRows.push({ name: "Outros custos variaveis classificados", value: gap });
  }

  return visibleRows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
}

function fixedCostRows(unit) {
  const variableGroups = new Set(["CMV", "Embalagens", "Impostos", "Comissoes"]);
  const rows = new Map();
  const detailGroupTotals = {};

  [...unit.detail]
    .filter((item) => item.group !== "Receita")
    .filter((item) => !variableGroups.has(item.group))
    .filter((item) => {
      const name = normalizedText(item.name);
      if (item.group === "Nao operacional") return false;
      return true;
    })
    .forEach((item) => {
      const name = normalizeDetailName(item.group, item.name);
      const key = `${item.group}::${name}`;
      const current = rows.get(key) || { name, group: item.group, value: 0 };
      current.value += item.value;
      detailGroupTotals[item.group] = (detailGroupTotals[item.group] || 0) + item.value;
      rows.set(key, current);
    });

  [
    ["Publicidade", unit.categories.publicity || 0],
    ["Uso e consumo", unit.categories.useAndConsumption || 0],
    ["Material operacional", Math.max((unit.categories.operationalMaterial || 0) - (detailGroupTotals["Material operacional"] || 0), 0)],
    ["Juridico / contador / taxas legais", unit.categories.legal || 0]
  ].forEach(([name, value]) => {
    if (value > 0) {
      rows.set(`Extra::${name}`, { name, group: "Outros fixos", value });
    }
  });

  const visibleRows = [...rows.values()];
  const visibleTotal = visibleRows.reduce((sum, row) => sum + row.value, 0);
  const gap = fixedCost(unit) - visibleTotal;
  if (Math.abs(gap) > 1) {
    visibleRows.push({ name: "Outros custos fixos classificados", group: "Outros fixos", value: gap });
  }

  return visibleRows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
}

function contributionMargin(unit) {
  return displayRevenue(unit) > 0 ? 1 - variableCost(unit) / displayRevenue(unit) : 0;
}

function breakEven(unit) {
  const margin = contributionMargin(unit);
  return margin > 0 ? fixedCost(unit) / margin : 0;
}

function percentOfRevenue(unit, value) {
  return displayRevenue(unit) > 0 ? value / displayRevenue(unit) : 0;
}

function percentOfTotal(total, value) {
  return total > 0 ? value / total : 0;
}

function combineNamedRows(rows) {
  const map = rows.reduce((currentMap, row) => {
    const current = currentMap.get(row.name) || { code: row.code || row.name, name: row.name, value: 0, children: [] };
    current.value += row.value;
    current.children = combineNamedRows([...(current.children || []), ...(row.children || [])]);
    currentMap.set(row.name, current);
    return currentMap;
  }, new Map());

  return [...map.values()].sort((a, b) => b.value - a.value);
}

function combineCategoryDetails(units) {
  const keys = new Set();
  units.forEach((unit) => {
    Object.keys(unit.categoryDetails || {}).forEach((key) => keys.add(key));
  });

  return [...keys].reduce((details, key) => {
    details[key] = combineNamedRows(units.flatMap((unit) => unit.categoryDetails?.[key] || []));
    return details;
  }, {});
}

function applyHierarchy() {
  const month = window.financeDataset?.months?.[0] || "2026-03";
  const hierarchyName = "financeHierarchy" + month.replace("-", "");
  const hierarchy = window[hierarchyName] || window.financeHierarchy202603 || {};
  window.financeDataset.units.forEach((unit) => {
    const unitHierarchy = hierarchy[unit.id];
    if (unitHierarchy) {
      unit.revenueDetail = unitHierarchy.revenueDetail || unit.revenueDetail || [];
      unit.categoryDetails = unitHierarchy.categoryDetails || unit.categoryDetails || {};
    }
  });
}

function flattenRows(rows) {
  return rows.flatMap((row) => [row, ...flattenRows(row.children || [])]);
}

function currentDrillParentCode() {
  return state.costDrillPath.at(-1) || null;
}

function currentDrillParent(unit, categoryKey) {
  const parentCode = currentDrillParentCode();
  if (!parentCode) {
    return null;
  }
  return flattenRows(unit.categoryDetails?.[categoryKey] || [])
    .find((row) => (row.code || row.name) === parentCode) || null;
}

function findCategoryNode(unit, categoryKey, key) {
  return flattenRows(unit.categoryDetails?.[categoryKey] || [])
    .find((row) => (row.code || row.name) === key) || null;
}

function pieBackground(items) {
  let cursor = 0;
  const stops = items
    .filter((item) => item.value > 0)
    .map((item, index) => {
      const start = cursor;
      const end = cursor + item.value;
      cursor = end;
      return `${item.color || palette[index % palette.length]} ${start}% ${end}%`;
    });
  return `conic-gradient(${stops.join(", ")})`;
}

function pieSlicePath(cx, cy, r, startPercent, endPercent) {
  const startAngle = startPercent * 3.6 - 90;
  const endAngle = endPercent * 3.6 - 90;
  const start = {
    x: cx + r * Math.cos((Math.PI * startAngle) / 180),
    y: cy + r * Math.sin((Math.PI * startAngle) / 180)
  };
  const end = {
    x: cx + r * Math.cos((Math.PI * endAngle) / 180),
    y: cy + r * Math.sin((Math.PI * endAngle) / 180)
  };
  const largeArc = endPercent - startPercent > 50 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function renderPieSvg(items, className = "", dataKey = "key") {
  let cursor = 0;
  const slices = items
    .filter((item) => item.value > 0)
    .map((item, index) => {
      const start = cursor;
      const end = cursor + item.value;
      cursor = end;
      const key = item[dataKey] || "";
      return `
        <path
          class="pie-slice ${item.active ? "active" : ""}"
          d="${pieSlicePath(50, 50, 48, start, end)}"
          fill="${item.color || palette[index % palette.length]}"
          data-category="${key}"
          tabindex="0"
          role="button"
          aria-label="${item.label || labels[key] || "Fatia"}"
        ></path>
      `;
    })
    .join("");

  return `<svg class="pie-svg ${className}" viewBox="0 0 100 100" aria-hidden="false">${slices}</svg>`;
}

function combineUnits(id, name, units) {
  const keys = new Set();
  units.forEach((unit) => Object.keys(unit.categories).forEach((key) => keys.add(key)));
  const categories = {};
  keys.forEach((key) => {
    categories[key] = units.reduce((sum, unit) => sum + (unit.categories[key] || 0), 0);
  });

  const variableKeys = new Set();
  units.forEach((unit) => Object.keys(unit.variableItems).forEach((key) => variableKeys.add(key)));
  const variableItems = {};
  variableKeys.forEach((key) => {
    variableItems[key] = units.reduce((sum, unit) => sum + (unit.variableItems[key] || 0), 0);
  });

  return {
    id,
    name,
    month: window.financeDataset?.months?.[0] || units[0]?.month || "2026-03",
    source: "",
    revenue: units.reduce((sum, unit) => sum + unit.revenue, 0),
    expenses: units.reduce((sum, unit) => sum + unit.expenses, 0),
    operationalExpenses: units.reduce((sum, unit) => sum + unit.operationalExpenses, 0),
    realProfit: units.reduce((sum, unit) => sum + unit.realProfit, 0),
    cashRevenue: units.reduce((sum, unit) => sum + (unit.cashRevenue ?? unit.revenue), 0),
    cashExpenses: units.reduce((sum, unit) => sum + (unit.cashExpenses ?? unit.expenses), 0),
    cashResult: units.reduce((sum, unit) => sum + displayCashResult(unit), 0),
    categories,
    variableItems,
    bankAccounts: units.flatMap((unit) => unit.bankAccounts || []),
    revenueDetail: combineNamedRows(units.flatMap((unit) => unit.revenueDetail || [])),
    categoryDetails: combineCategoryDetails(units),
    detail: units.flatMap((unit) =>
      unit.detail.map((item) => ({ ...item, name: `${unit.name}: ${item.name}` }))
    )
  };
}

function getUnits() {
  return window.financeDataset.units;
}

function currentDefinition() {
  return views[state.selected] || views.all;
}

function visibleUnits() {
  const definition = currentDefinition();
  return getUnits().filter((unit) => definition.unitIds.includes(unit.id));
}

function currentView() {
  const units = visibleUnits();
  const definition = currentDefinition();
  return units.length === 1 ? units[0] : combineUnits(definition.id, definition.name, units);
}

function packageView(dataset, definition) {
  const units = dataset.units.filter((unit) => definition.unitIds.includes(unit.id));
  return units.length === 1 ? units[0] : combineUnits(definition.id, definition.name, units);
}

function currentPackage() {
  const month = window.financeDataset.months?.[0] || "2026-03";
  const hierarchyName = "financeHierarchy" + month.replace("-", "");
  return {
    version: 3,
    importModel: "competence-cash-v3",
    type: "la-bicyclette-financeiro",
    month,
    dataset: window.financeDataset,
    hierarchy: window[hierarchyName] || {}
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderSummary(unit) {
  const metrics = [
    ["Faturamento", displayRevenue(unit), "Relatorio Linx por competencia", "revenue"],
    ["Despesas", displayExpenses(unit), profitDistribution(unit) > 0 ? `inclui ${money.format(profitDistribution(unit))} de distribuicao` : `${pct.format(percentOfRevenue(unit, displayExpenses(unit)))} do faturamento`],
    ["Lucro real", displayProfit(unit), `${pct.format(percentOfRevenue(unit, displayProfit(unit)))} de margem`],
    ["Ponto de equilibrio", breakEven(unit), `${pct.format(contributionMargin(unit))} margem de contribuicao`]
  ];

  document.querySelector("#summary").innerHTML = metrics
    .map(([label, value, sub, action]) => `
      <${action ? "button" : "article"} class="metric ${action && state.activeSummaryMetric === action ? "active" : ""}" ${action ? `type="button" data-summary="${action}"` : ""}>
        <span class="label">${label}</span>
        <span class="value ${value < 0 ? "negative" : label === "Lucro real" ? "positive" : ""}">${money.format(value)}</span>
        <span class="sub">${sub}</span>
      </${action ? "button" : "article"}>
    `)
    .join("");

  document.querySelectorAll("[data-summary]").forEach((element) => {
    element.addEventListener("click", () => {
      state.activeSummaryMetric = state.activeSummaryMetric === element.dataset.summary ? null : element.dataset.summary;
      renderSummary(unit);
      renderSummaryDetail(unit);
    });
  });
}

function renderSummaryDetail(unit) {
  const container = document.querySelector("#summaryDetail");
  if (state.activeSummaryMetric !== "revenue") {
    container.innerHTML = "";
    container.classList.remove("visible");
    return;
  }

  const rows = unit.revenueDetail || [];
  container.classList.add("visible");
  container.innerHTML = `
    <div class="category-detail revenue-detail">
      <div class="category-detail-head" style="border-color:${palette[1]}">
        <span class="swatch" style="background:${palette[1]}"></span>
        <div>
          <strong>Detalhe do faturamento</strong>
          <small>${money.format(displayRevenue(unit))} por origem no relatorio de competencia</small>
        </div>
      </div>
      <div class="detail-bars scrollable">
        ${rows.map((row) => `
          <div class="detail-bar-row">
            <span>${row.name}</span>
            <strong>${money.format(row.value)}</strong>
            <div class="detail-track">
              <div style="width:${Math.min(percentOfTotal(displayRevenue(unit), row.value) * 100, 100)}%; background:${palette[1]}"></div>
            </div>
            ${row.children?.length ? `
              <div class="detail-child-list">
                ${row.children.map((child) => `
                  <span>${child.name}</span>
                  <strong>${money.format(child.value)}</strong>
                `).join("")}
              </div>
            ` : ""}
          </div>
        `).join("") || `<p class="detail-empty">Nao ha detalhe de faturamento importado para esta aba.</p>`}
      </div>
    </div>
  `;
}

function renderUnitSummary(units) {
  const container = document.querySelector("#unitSummary");

  if (state.selected === "all" || units.length < 2) {
    container.innerHTML = "";
    container.classList.remove("visible");
    return;
  }

  container.classList.add("visible");
  container.innerHTML = units
    .map((unit) => `
      <article class="unit-summary-card">
        <div>
          <span class="label">${unit.name}</span>
          <strong>${money.format(displayRevenue(unit))}</strong>
          <small>faturamento</small>
        </div>
        <div>
          <span class="label">Lucro real</span>
          <strong class="${displayProfit(unit) < 0 ? "negative" : "positive"}">${money.format(displayProfit(unit))}</strong>
          <small>${pct.format(percentOfRevenue(unit, displayProfit(unit)))} de margem</small>
        </div>
        <div>
          <span class="label">Ponto de equilibrio</span>
          <strong>${money.format(breakEven(unit))}</strong>
          <small>${pct.format(contributionMargin(unit))} contribuicao</small>
        </div>
      </article>
    `)
    .join("");
}

function renderAccountingNote(unit) {
  const nonOperational = unit.categories.nonOperational || 0;
  const operational = unit.operationalExpenses || 0;
  const distribution = profitDistribution(unit);
  document.querySelector("#accountingNote").innerHTML = `
    <div class="panel-title compact-title">
      <div>
        <p class="eyebrow">Leitura dos numeros</p>
        <h2>Competencia em cima, caixa na conferencia bancaria</h2>
      </div>
    </div>
    <div class="note-grid">
      <p><strong>Parte superior</strong> usa os relatorios por competencia: faturamento, despesas, lucro real, categorias e ponto de equilibrio.</p>
      <p><strong>Conferencia bancaria</strong> usa os relatorios por caixa comparados aos extratos. Aqui na competencia: ${money.format(operational)} operacionais + ${money.format(nonOperational)} nao operacionais.</p>
      <p><strong>Nao operacional</strong> inclui itens como investimentos, obras/equipamentos e distribuicao de lucros${distribution ? ` (${money.format(distribution)} nesta visao)` : ""}.</p>
    </div>
  `;
}

function renderBars(units) {
  const max = Math.max(...units.flatMap((unit) => [displayRevenue(unit), displayExpenses(unit), Math.abs(displayProfit(unit))]), 1);
  document.querySelector("#barChart").innerHTML = units
    .map((unit) => `
      <div class="bar-row">
        <div class="bar-name">${unit.name}</div>
        <div class="bars" aria-label="Valores de ${unit.name}">
          <div class="bar-track"><div class="bar-fill revenue" style="width:${(displayRevenue(unit) / max) * 100}%"></div></div>
          <div class="bar-track"><div class="bar-fill expenses" style="width:${(displayExpenses(unit) / max) * 100}%"></div></div>
          <div class="bar-track"><div class="bar-fill profit" style="width:${(Math.abs(displayProfit(unit)) / max) * 100}%"></div></div>
        </div>
        <div class="bar-value">${money.format(displayRevenue(unit))}<br>${money.format(displayProfit(unit))}</div>
      </div>
    `)
    .join("");
}

function categoryValue(unit, key) {
  return unit.categories[key] || 0;
}

function normalizeDetailName(group, name) {
  const cleanName = name.replace(/^[^:]+:\s/, "");
  if (group === "Pessoal" && /folha de pagamento|comissao a deduzir/i.test(cleanName)) {
    return "Folha + comissoes";
  }
  return cleanName;
}

function sourceUnitName(name) {
  const match = name.match(/^([^:]+):\s(.+)$/);
  return match ? match[1] : "";
}

function rawDetailName(name) {
  return name.replace(/^[^:]+:\s/, "");
}

function categoryGroup(key) {
  return {
    cmv: "CMV",
    packaging: "Embalagens",
    taxes: "Impostos",
    people: "Pessoal",
    occupancy: "Ocupacao",
    thirdParty: "Terceiros",
    operationalMaterial: "Material operacional",
    nonOperational: "Nao operacional"
  }[key];
}

function categoryBreakdown(unit, key) {
  const structuredRows = unit.categoryDetails?.[key];
  if (structuredRows?.length) {
    const parent = currentDrillParent(unit, key);
    const visibleRows = parent ? parent.children || [] : structuredRows;
    return visibleRows.map((row) => ({ ...row, key: row.code || row.name }));
  }

  const group = categoryGroup(key);

  if (!group) {
    return [{ key: labels[key], name: labels[key], value: categoryValue(unit, key) }];
  }

  const rows = unit.detail
    .filter((item) => item.group === group)
    .reduce((map, item) => {
      const name = normalizeDetailName(group, item.name);
      const current = map.get(name) || { key: name, name, value: 0 };
      current.value += item.value;
      map.set(name, current);
      return map;
    }, new Map());

  const details = [...rows.values()]
    .sort((a, b) => b.value - a.value);

  return details.length ? details : [{ key: labels[key], name: labels[key], value: categoryValue(unit, key) }];
}

function selectedCategoryNode(unit, categoryKey) {
  const structuredRows = unit.categoryDetails?.[categoryKey] || [];
  return flattenRows(structuredRows).find((row) => (row.code || row.name) === state.activeCostSubcategory);
}

function subcategoryBreakdown(unit, categoryKey, subcategoryName) {
  const structured = selectedCategoryNode(unit, categoryKey);
  if (structured) {
    return (structured.children || []).map((row) => ({ ...row, key: row.code || row.name }));
  }

  const group = categoryGroup(categoryKey);
  if (!group || !subcategoryName) {
    return [];
  }

  const matchedItems = unit.detail.filter((item) =>
    item.group === group && normalizeDetailName(group, item.name) === subcategoryName
  );

  const byUnit = matchedItems.reduce((map, item) => {
    const source = sourceUnitName(item.name);
    if (!source) {
      return map;
    }
    map.set(source, (map.get(source) || 0) + item.value);
    return map;
  }, new Map());

  if (byUnit.size > 1) {
    return [...byUnit.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  const byRawName = matchedItems.reduce((map, item) => {
    const name = rawDetailName(item.name);
    if (name === subcategoryName) {
      return map;
    }
    map.set(name, (map.get(name) || 0) + item.value);
    return map;
  }, new Map());

  return [...byRawName.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function renderSubcategoryDetails(unit, activeKey, activeColor, rows) {
  const selected = selectedCategoryNode(unit, activeKey) || rows.find((row) => row.key === state.activeCostSubcategory);

  const parent = currentDrillParent(unit, activeKey);
  const header = parent ? `
    <button class="drill-back" data-drill-back type="button" aria-label="Voltar">
      <span aria-hidden="true">‚Üê</span>
      <strong>${parent.name}</strong>
    </button>
  ` : "";

  if (!selected) {
    return header || `
      <div class="subcategory-panel idle">
        <strong>Escolha uma subcategoria</strong>
        <span>Clique em um item acima para abrir a proxima camada de detalhe sem perder esta lista.</span>
      </div>
    `;
  }

  const subRows = subcategoryBreakdown(unit, activeKey, selected.name);
  if (!subRows.length) {
    return `
      <div class="subcategory-panel">
        ${header}
        <div class="subcategory-head">
          <strong>${selected.name}</strong>
          <span>${money.format(selected.value)}</span>
        </div>
        <p>Nao ha detalhe mais granular para esta subcategoria nos dados importados.</p>
      </div>
    `;
  }

  return `
    <div class="subcategory-panel">
      ${header}
      <div class="subcategory-head">
        <strong>${selected.name}</strong>
        <span>${money.format(selected.value)}</span>
      </div>
      <div class="detail-bars nested">
        ${subRows.map((row) => `
          <button class="detail-bar-row detail-button ${row.key === state.activeCostSubcategory ? "active" : ""}" data-subcategory="${row.key}" type="button">
            <span>${row.name}</span>
            <strong>${money.format(row.value)}</strong>
            <div class="detail-track">
              <div style="width:${Math.min(percentOfTotal(selected.value, row.value) * 100, 100)}%; background:${activeColor}"></div>
            </div>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCostDetails(unit, activeKey, activeColor) {
  const rows = categoryBreakdown(unit, activeKey);
  const total = categoryValue(unit, activeKey);
  return `
    <div class="category-detail">
      <div class="category-detail-head" style="border-color:${activeColor}">
        <span class="swatch" style="background:${activeColor}"></span>
        <div>
          <strong>${labels[activeKey]}</strong>
          <small>${money.format(total)} ¬∑ ${pct.format(percentOfRevenue(unit, total))} do faturamento</small>
        </div>
      </div>
      <div class="detail-bars scrollable">
        ${rows.map((row) => `
          <button class="detail-bar-row detail-button ${row.key === state.activeCostSubcategory ? "active" : ""}" data-subcategory="${row.key}" type="button">
            <span>${row.name}</span>
            <strong>${money.format(row.value)}</strong>
            <div class="detail-track">
              <div style="width:${Math.min(percentOfTotal(total, row.value) * 100, 100)}%; background:${activeColor}"></div>
            </div>
          </button>
        `).join("")}
      </div>
      ${renderSubcategoryDetails(unit, activeKey, activeColor, rows)}
    </div>
  `;
}

function renderCostMix(unit) {
  const keys = [
    "cmv",
    "packaging",
    "people",
    "taxes",
    "occupancy",
    "thirdParty",
    "commissions",
    "publicity",
    "useAndConsumption",
    "operationalMaterial",
    "legal",
    "nonOperational"
  ];
  const items = keys
    .map((key) => ({ key, value: categoryValue(unit, key) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!items.some((item) => item.key === state.activeCostCategory)) {
    state.activeCostCategory = items[0]?.key || "cmv";
  }
  const pieItems = items.map((item, index) => ({
    ...item,
    color: palette[index % palette.length],
    value: percentOfTotal(total, item.value) * 100,
    active: item.key === state.activeCostCategory,
    label: labels[item.key]
  }));
  const activeItem = pieItems.find((item) => item.key === state.activeCostCategory) || pieItems[0];

  document.querySelector("#costMix").innerHTML = items
    .map((item, index) => ({ ...item, color: palette[index % palette.length] }))
    .reduce((html, item, index) => {
      if (index === 0) {
        html += `
          <div class="pie-wrap">
            ${renderPieSvg(pieItems, "main-pie")}
            <div class="pie-center">
              <strong>${money.format(total)}</strong>
              <span>saidas totais</span>
            </div>
          </div>
          <div class="legend-list">
        `;
      }
      html += `
        <button class="legend-item legend-button ${item.key === state.activeCostCategory ? "active" : ""}" data-category="${item.key}" type="button">
          <span class="swatch" style="background:${item.color}"></span>
          <span>${labels[item.key]}</span>
          <strong>${money.format(item.value)}</strong>
          <em>${pct.format(percentOfTotal(total, item.value))}</em>
        </button>
      `;
      if (index === items.length - 1) {
        html += `</div>${renderCostDetails(unit, activeItem.key, activeItem.color)}`;
      }
      return html;
    }, "");

  document.querySelectorAll("[data-category]").forEach((element) => {
    element.addEventListener("click", () => {
      state.activeCostCategory = element.dataset.category;
      state.activeCostSubcategory = null;
      state.costDrillPath = [];
      renderCostMix(currentView());
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        state.activeCostCategory = element.dataset.category;
        state.activeCostSubcategory = null;
        state.costDrillPath = [];
        renderCostMix(currentView());
      }
    });
  });

  document.querySelectorAll("[data-subcategory]").forEach((element) => {
    element.addEventListener("click", () => {
      const node = findCategoryNode(currentView(), state.activeCostCategory, element.dataset.subcategory);
      if (node?.children?.length) {
        state.costDrillPath.push(node.code || node.name);
        state.activeCostSubcategory = null;
      } else {
        state.activeCostSubcategory = element.dataset.subcategory;
      }
      renderCostMix(currentView());
    });
  });

  document.querySelectorAll("[data-drill-back]").forEach((element) => {
    element.addEventListener("click", () => {
      state.costDrillPath.pop();
      state.activeCostSubcategory = null;
      renderCostMix(currentView());
    });
  });
}

function renderBreakEven(unit) {
  const be = breakEven(unit);
  const distance = displayRevenue(unit) - be;
  document.querySelector("#breakEven").innerHTML = `
    <div class="be-number ${distance < 0 ? "negative" : "positive"}">${money.format(be)}</div>
    <p class="be-note">
      <button class="inline-detail-button" data-cost-detail="fixed" type="button">Custos fixos estimados</button>: <strong>${money.format(fixedCost(unit))}</strong>.<br>
      <button class="inline-detail-button" data-cost-detail="variable" type="button">Custos variaveis considerados</button>: <strong>${money.format(variableCost(unit))}</strong>.<br>
      ${distance >= 0 ? `A unidade ficou ${money.format(distance)} acima do equilibrio.` : `Faltaram ${money.format(Math.abs(distance))} para empatar operacionalmente.`}
    </p>
    <div class="pill-row">
      <span class="pill">CMV comida ${pct.format(percentOfRevenue(unit, unit.categories.cmv || 0))}</span>
      <span class="pill">Embalagens ${pct.format(percentOfRevenue(unit, unit.categories.packaging || 0))}</span>
      <span class="pill">Pessoal ${pct.format(percentOfRevenue(unit, unit.categories.people || 0))}</span>
      <span class="pill">Ocupacao ${pct.format(percentOfRevenue(unit, unit.categories.occupancy || 0))}</span>
    </div>
  `;

  document.querySelectorAll("[data-cost-detail]").forEach((button) => {
    button.addEventListener("click", () => renderCostDetailDialog(unit, button.dataset.costDetail));
  });
}

function renderCostDetailDialog(unit, type) {
  const isFixed = type === "fixed";
  const rows = isFixed ? fixedCostRows(unit) : variableCostRows(unit);
  const total = isFixed ? fixedCost(unit) : variableCost(unit);
  const subtitle = isFixed
    ? "Despesas operacionais que sobraram depois de retirar os custos variaveis usados na margem de contribuicao."
    : "Itens tratados como variaveis para calcular margem de contribuicao e ponto de equilibrio.";

  const existing = document.querySelector("#costDetailDialog");
  existing?.remove();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="dialog-backdrop" id="costDetailDialog">
      <section class="cost-dialog" role="dialog" aria-modal="true" aria-label="${isFixed ? "Custos fixos" : "Custos variaveis"}">
        <div class="subcategory-head">
          <div>
            <strong>${isFixed ? "Custos fixos estimados" : "Custos variaveis considerados"}</strong>
            <p>${subtitle}</p>
          </div>
          <button class="dialog-close" type="button" aria-label="Fechar">&times;</button>
        </div>
        <div class="cost-dialog-total">${money.format(total)}</div>
        <div class="detail-bars scrollable">
          ${rows.map((row) => `
            <div class="detail-bar-row">
              <span>${row.name}</span>
              <strong>${money.format(row.value)}</strong>
              <div class="detail-track">
                <div style="width:${Math.min(percentOfTotal(total, row.value) * 100, 100)}%; background:${isFixed ? palette[5] : palette[0]}"></div>
              </div>
            </div>
          `).join("") || `<p class="detail-empty">Nao ha itens para mostrar.</p>`}
        </div>
      </section>
    </div>
  `);

  const dialog = document.querySelector("#costDetailDialog");
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.remove();
  });
}

function detailRows(unit, limit = 10) {
  const rows = [...unit.detail]
    .filter((item) => item.group !== "Receita")
    .reduce((map, item) => {
      const key = `${item.group}::${normalizeDetailName(item.group, item.name)}`;
      const current = map.get(key) || { group: item.group, name: normalizeDetailName(item.group, item.name), value: 0 };
      current.value += item.value;
      map.set(key, current);
      return map;
    }, new Map());

  return [...rows.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function renderDetailTable(unit, limit = 10) {
  const rows = detailRows(unit, limit);

  return `
    <div class="table-head">
      <span>Grupo</span><span>Item</span><span>Valor</span><span>% receita</span>
    </div>
    ${rows.map((row) => `
      <div class="table-row">
        <span>${row.group}</span>
        <strong>${row.name}</strong>
        <span>${money.format(row.value)}</span>
        <span>${pct.format(percentOfRevenue(unit, row.value))}</span>
      </div>
    `).join("")}
  `;
}

function renderDetailPie(unit, rows) {
  const total = displayExpenses(unit);
  const rowTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const remaining = Math.max(total - rowTotal, 0);
  const pieItems = rows.map((row, index) => ({
    value: percentOfTotal(total, row.value) * 100,
    color: palette[index % palette.length]
  }));
  pieItems.push({ value: percentOfTotal(total, remaining) * 100, color: neutral });

  return `
    <div class="detail-pie-card">
      <div class="pie small" style="background:${pieBackground(pieItems)}" aria-label="Peso dos principais custos"></div>
      <div class="legend-list compact">
        ${rows.map((row, index) => `
          <div class="legend-item">
            <span class="swatch" style="background:${palette[index % palette.length]}"></span>
            <span>${row.name}</span>
            <strong>${pct.format(percentOfTotal(total, row.value))}</strong>
          </div>
        `).join("")}
        <div class="legend-item muted">
          <span class="swatch" style="background:${neutral}"></span>
          <span>Outros custos</span>
          <strong>${pct.format(percentOfTotal(total, remaining))}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderDetail(unit, units) {
  const container = document.querySelector("#detailTable");

  if (units.length > 1) {
    container.innerHTML = units
      .map((item) => `
        <section class="unit-cost-card">
          <div class="unit-cost-title">
            <h3>${item.name}</h3>
            <span>${money.format(displayExpenses(item))} em despesas</span>
          </div>
          ${renderDetailPie(item, detailRows(item, 10))}
        </section>
      `)
      .join("");
    return;
  }

  const rows = detailRows(unit, 10);
  container.innerHTML = `
    ${renderDetailPie(unit, rows)}
  `;
}

function renderComparisonVisibility() {
  const section = document.querySelector("#comparisonSection");
  const comparisonPanel = section?.querySelector(".comparison-panel");
  const showComparison = ["jb", "barra-leblon"].includes(state.selected);

  if (!section || !comparisonPanel) {
    return;
  }

  comparisonPanel.hidden = !showComparison;
  section.classList.toggle("cost-only", !showComparison);
}

function renderAnalysis(unit) {
  const cmvRate = percentOfRevenue(unit, unit.categories.cmv || 0);
  const peopleRate = percentOfRevenue(unit, unit.categories.people || 0);
  const occupancyRate = percentOfRevenue(unit, unit.categories.occupancy || 0);
  const fixed = fixedCost(unit);
  const be = breakEven(unit);

  const cards = [
    `${unit.name}: distribuicao de lucros permanece dentro das despesas, mas aparece destacada separadamente por ser uma retirada nao operacional. Custo fixo operacional estimado em ${money.format(fixed)}, com ponto de equilibrio perto de ${money.format(be)}.`,
    `CMV comida em ${pct.format(cmvRate)} do faturamento. Embalagens ficam separadas como variavel operacional; loucas, limpeza e materiais operacionais entram no fixo.`,
    `Pessoal em ${pct.format(peopleRate)} do faturamento e ocupacao em ${pct.format(occupancyRate)}. Esses dois blocos explicam boa parte do custo fixo; valem escala, jornada, extras/dobras, aluguel/energia e manutencoes.`,
    `Motoboy esta classificado como custo fixo. Os custos variaveis ficam concentrados em CMV comida, embalagens/descartaveis, impostos e comissoes/tarifas.`
  ];

  document.querySelector("#analysis").innerHTML = cards
    .map((text) => `<div class="analysis-card">${text}</div>`)
    .join("");
}

function bankTotals(unit) {
  const accounts = unit.bankAccounts || [];
  return {
    accounts,
    openingBalance: accounts.reduce((sum, account) => sum + account.openingBalance, 0),
    credits: accounts.reduce((sum, account) => sum + account.credits, 0),
    debits: accounts.reduce((sum, account) => sum + account.debits, 0),
    closingBalance: accounts.reduce((sum, account) => sum + account.closingBalance, 0)
  };
}

function renderBankReconciliation(unit, units) {
  const totals = bankTotals(unit);
  const visibleUnitIds = new Set(units.map((item) => item.id));
  const ignoredBankFiles = (window.financeDataset.ignoredBankFiles || [])
    .filter((file) => !file.unitId || visibleUnitIds.has(file.unitId));
  const bankVariation = totals.closingBalance - totals.openingBalance;
  const reportCashResult = displayCashResult(unit);
  const difference = bankVariation - reportCashResult;
  const statusClass = difference >= 0 ? "positive" : "negative";
  const differenceText = difference >= 0
    ? `Banco mostra ${money.format(Math.abs(difference))} a mais do que o relatorio explica.`
    : `Banco mostra ${money.format(Math.abs(difference))} a menos do que o relatorio explica.`;

  const unitRows = units.length > 1
    ? units.map((item) => {
        const itemTotals = bankTotals(item);
        const itemVariation = itemTotals.closingBalance - itemTotals.openingBalance;
        const itemCashResult = displayCashResult(item);
        const itemDifference = itemVariation - itemCashResult;
        const itemStatusClass = itemDifference >= 0 ? "positive" : "negative";
        return `
          <div class="bank-unit-row">
            <strong>${item.name}</strong>
            <span>${money.format(itemVariation)}</span>
            <span>${money.format(itemCashResult)}</span>
            <span class="${itemStatusClass}">${money.format(itemDifference)}</span>
          </div>
        `;
      }).join("")
    : "";

  document.querySelector("#bankReconciliation").innerHTML = `
    <div class="bank-summary-grid">
      <article>
        <span>Saldo inicial</span>
        <strong>${money.format(totals.openingBalance)}</strong>
      </article>
      <article>
        <span>Entradas no banco</span>
        <strong>${money.format(totals.credits)}</strong>
      </article>
      <article>
        <span>Sa√≠das no banco</span>
        <strong>${money.format(totals.debits)}</strong>
      </article>
      <article>
        <span>Saldo final</span>
        <strong>${money.format(totals.closingBalance)}</strong>
      </article>
    </div>

    <div class="bank-compare">
      <div class="bank-step bank-step-bank">
        <span>Varia√ß√£o banc√°ria</span>
        <strong>${money.format(bankVariation)}</strong>
        <small>Saldo final - saldo inicial</small>
      </div>
      <div class="bank-step bank-step-report">
        <span>Resultado caixa do relat√≥rio de caixa</span>
        <strong>${money.format(reportCashResult)}</strong>
        <small>Base separada da an√°lise por compet√™ncia</small>
      </div>
      <div class="bank-step bank-step-difference ${statusClass}">
        <span>Diferen√ßa a investigar</span>
        <strong class="${statusClass}">${money.format(difference)}</strong>
        <small>${differenceText}</small>
      </div>
    </div>

    ${unitRows ? `
      <div class="bank-unit-table">
        <div class="bank-unit-row head">
          <strong>Unidade</strong>
          <span>Varia√ß√£o banco</span>
          <span>Resultado caixa</span>
          <span>Diferen√ßa</span>
        </div>
        ${unitRows}
      </div>
    ` : ""}

    <div class="bank-account-list">
      ${totals.accounts.map((account) => `
        <article>
          <div>
            <strong>${account.bank}</strong>
            <span>Unidade: ${account.unitName || account.account}</span>
          </div>
          <div>
            <span>Inicial ${money.format(account.openingBalance)}</span>
            <span>Entradas ${money.format(account.credits)}</span>
            <span>Sa√≠das ${money.format(account.debits)}</span>
            <span>Final ${money.format(account.closingBalance)}</span>
          </div>
          <p>Arquivo: ${account.source || "extrato importado"}</p>
          ${account.note ? `<p>${account.note}</p>` : ""}
        </article>
      `).join("")}
      ${ignoredBankFiles.map((file) => `
        <article class="bank-account-warning">
          <div>
            <strong>${file.bank || "Banco"}</strong>
            <span>Unidade: ${file.unitName || "nao identificada"}</span>
          </div>
          <div>
            <span>Extrato nao integrado</span>
          </div>
          <p>Arquivo: ${file.source}</p>
          <p>${file.reason}</p>
        </article>
      `).join("")}
    </div>

    <p class="bank-note">
      A compara√ß√£o principal usa o resultado do relat√≥rio de caixa, com distribui√ß√£o de lucros dentro das despesas, porque essa retirada tamb√©m aparece como sa√≠da de dinheiro no banco.
    </p>
  `;
}

function loadSavedPackages() {
  try {
    const saved = JSON.parse(localStorage.getItem("financeiroComparisonPackages") || "[]");
    state.comparisonPackages = saved.filter((item) => item?.type === "la-bicyclette-financeiro");
  } catch {
    state.comparisonPackages = [];
  }
}

function savePackages() {
  localStorage.setItem("financeiroComparisonPackages", JSON.stringify(state.comparisonPackages));
}

function deltaClass(value) {
  return value >= 0 ? "positive" : "negative";
}

function formatDelta(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return `<em class="${deltaClass(value)}">${value >= 0 ? "+" : ""}${pct.format(value)}</em>`;
}

function formatPointDelta(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return `<em class="${deltaClass(value)}">${value >= 0 ? "+" : ""}${(value * 100).toFixed(1).replace(".", ",")} p.p.</em>`;
}

function metricDelta(row, previous, key) {
  if (!previous || !previous[key]) {
    return "";
  }
  return formatDelta((row[key] - previous[key]) / Math.abs(previous[key]));
}

function rateDelta(row, previous, key) {
  if (!previous) {
    return "";
  }
  return formatPointDelta(row[key] - previous[key]);
}

function sparklinePath(values, width = 180, height = 46) {
  if (!values.length) {
    return "";
  }
  if (values.length === 1) {
    return `M 0 ${height / 2} L ${width} ${height / 2}`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 8) - 4;
    return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function renderSparkCard(rows, key, label, color) {
  const values = rows.map((row) => row[key] || 0);
  const current = rows.at(-1)?.[key] || 0;
  const previous = rows.at(-2)?.[key];
  const delta = previous === undefined ? "" : formatPointDelta(current - previous);
  return `
    <article class="spark-card">
      <div>
        <span>${label}</span>
        <strong>${pct.format(current)}</strong>
        ${delta}
      </div>
      <svg class="sparkline" viewBox="0 0 180 46" aria-hidden="true">
        <path d="${sparklinePath(values)}" style="stroke:${color}"></path>
      </svg>
    </article>
  `;
}

function renderEvolution() {
  const container = document.querySelector("#evolution");
  const definition = currentDefinition();
  const current = currentPackage();
  const packages = [...state.comparisonPackages, current]
    .filter((pack, index, all) => all.findIndex((item) => item.month === pack.month) === index)
    .sort((a, b) => a.month.localeCompare(b.month));

  const rows = packages.map((pack) => {
    const view = packageView(pack.dataset, definition);
    return {
      month: pack.month,
      revenue: displayRevenue(view),
      expenses: displayExpenses(view),
      cmv: view.categories.cmv || 0,
      taxes: view.categories.taxes || 0,
      people: view.categories.people || 0,
      occupancy: view.categories.occupancy || 0,
      profit: displayProfit(view),
      breakEven: breakEven(view),
      bankDifference: bankTotals(view).closingBalance - bankTotals(view).openingBalance - displayCashResult(view),
      cmvRate: percentOfRevenue(view, view.categories.cmv || 0),
      taxesRate: percentOfRevenue(view, view.categories.taxes || 0),
      peopleRate: percentOfRevenue(view, view.categories.people || 0),
      occupancyRate: percentOfRevenue(view, view.categories.occupancy || 0)
    };
  });

  container.innerHTML = `
    <div class="evolution-actions">
      <button class="unit-button active" id="exportPackage" type="button">Exportar pacote do mes</button>
      <label class="unit-button import-package">
        Importar meses anteriores
        <input id="importPackages" type="file" accept=".json,.financeiro.json,application/json" multiple>
      </label>
      ${state.comparisonPackages.length ? `<button class="unit-button" id="clearPackages" type="button">Limpar importados</button>` : ""}
    </div>

    ${rows.length < 2 ? `
      <div class="evolution-placeholder">
        <strong>Pronto para comparar.</strong>
        <span>Importe um ou mais pacotes de meses anteriores para comparar faturamento, despesas, CMV, pessoal, ocupacao, lucro, ponto de equilibrio e diferenca bancaria.</span>
      </div>
    ` : `
      <div class="evolution-sparks">
        ${renderSparkCard(rows, "cmvRate", "CMV comida", palette[0])}
        ${renderSparkCard(rows, "peopleRate", "Pessoal", palette[1])}
        ${renderSparkCard(rows, "occupancyRate", "Ocupacao", palette[2])}
        ${renderSparkCard(rows, "taxesRate", "Impostos", palette[3])}
      </div>
      <div class="evolution-table">
        <div class="evolution-row head">
          <span>Mes</span><span>Faturamento</span><span>Despesas</span><span>CMV comida</span><span>Pessoal</span><span>Ocupacao</span><span>Impostos</span><span>Lucro</span><span>Equilibrio</span><span>Dif. banco</span>
        </div>
        ${rows.map((row, index) => {
          const previous = rows[index - 1];
          return `
            <div class="evolution-row">
              <strong>${row.month}</strong>
              <span>${money.format(row.revenue)} ${metricDelta(row, previous, "revenue")}</span>
              <span>${money.format(row.expenses)} ${metricDelta(row, previous, "expenses")}</span>
              <span>${pct.format(row.cmvRate)} ${rateDelta(row, previous, "cmvRate")}</span>
              <span>${pct.format(row.peopleRate)} ${rateDelta(row, previous, "peopleRate")}</span>
              <span>${pct.format(row.occupancyRate)} ${rateDelta(row, previous, "occupancyRate")}</span>
              <span>${pct.format(row.taxesRate)} ${rateDelta(row, previous, "taxesRate")}</span>
              <span class="${row.profit >= 0 ? "positive" : "negative"}">${money.format(row.profit)} ${metricDelta(row, previous, "profit")}</span>
              <span>${money.format(row.breakEven)} ${metricDelta(row, previous, "breakEven")}</span>
              <span class="${row.bankDifference >= 0 ? "positive" : "negative"}">${money.format(row.bankDifference)}</span>
            </div>
          `;
        }).join("")}
      </div>
    `}
  `;

  document.querySelector("#exportPackage")?.addEventListener("click", () => {
    const pack = currentPackage();
    downloadJson(`${pack.month}.financeiro.json`, pack);
  });

  document.querySelector("#importPackages")?.addEventListener("change", async (event) => {
    const imported = [];
    for (const file of event.target.files) {
      const payload = JSON.parse(await file.text());
      if (payload?.type === "la-bicyclette-financeiro") {
        imported.push(payload);
      }
    }
    state.comparisonPackages = [...state.comparisonPackages, ...imported]
      .filter((pack, index, all) => all.findIndex((item) => item.month === pack.month) === index);
    savePackages();
    renderEvolution();
  });

  document.querySelector("#clearPackages")?.addEventListener("click", () => {
    state.comparisonPackages = [];
    savePackages();
    renderEvolution();
  });
}

function render() {
  const unit = currentView();
  const units = visibleUnits();
  renderComparisonVisibility();
  renderSummary(unit);
  renderSummaryDetail(unit);
  renderUnitSummary(units);
  renderAccountingNote(unit);
  renderBars(units);
  renderCostMix(unit);
  renderBreakEven(unit);
  renderDetail(unit, units);
  renderAnalysis(unit);
  renderBankReconciliation(unit, units);
  renderEvolution();
}

function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(date)
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

const monthElement = document.querySelector("#dashboardMonthLabel");
if (monthElement) {
  monthElement.textContent = `${monthLabel(window.financeDataset.months?.[0] || "2026-03")} ¬∑ Portal Linx Menew`;
}

document.querySelectorAll(".unit-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".unit-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.selected = button.dataset.unit;
    state.activeCostSubcategory = null;
    state.costDrillPath = [];
    state.activeSummaryMetric = null;
    render();
  });
});

loadSavedPackages();
applyHierarchy();
render();
