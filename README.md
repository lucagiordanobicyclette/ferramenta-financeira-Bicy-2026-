# Dashboard Financeiro La Bicyclette

Primeira versao local para transformar os relatorios do Portal Linx Menew em uma leitura visual por unidade.

## Contexto vivo do projeto

Antes de continuar o projeto em outra conversa, leia `CONTEXTO_PROJETO.md`. Ele guarda as regras de unidades, nomes das razoes sociais, conferencia bancaria, distribuicao de lucros, leitura gerencial de marco/2026 e cuidados de deploy.

## Como abrir

Abra `iniciar_ferramenta.command` e deixe a janela aberta.

- Dashboard: `http://localhost:4173/index.html`
- Importador: `http://localhost:4173/admin.html`

O dashboard tambem abre direto pelo arquivo `index.html`. O importador online processa PDFs no navegador; o servidor local acima tambem permite salvar/gerar os arquivos do mes no computador.

## Como usar na Vercel

- `index.html`: dashboard base publicado.
- `admin.html`: importador online.
- `api/upload-month.py`: API Python que processa os PDFs e devolve o pacote do mes.

Na Vercel, o mes importado fica salvo no navegador de quem fez o upload e pode ser baixado como `AAAA-MM.financeiro.json`. Para publicar automaticamente o mes para todo mundo, adicione armazenamento autenticado antes de usar em producao.

## Como usar gratis no GitHub Pages

Esta e a opcao recomendada para compartilhar sem servidor.

- `index.html`: dashboard interativo.
- `admin.html`: importador que processa os PDFs diretamente no navegador.
- `browser-importer.js`: parser JavaScript dos PDFs.

Fluxo:

1. A pessoa abre `admin.html` pelo link do GitHub Pages.
2. Seleciona os 4 PDFs por competencia, usados na analise gerencial da parte superior.
3. Seleciona os 4 PDFs por caixa, usados na conferencia bancaria.
4. Seleciona os extratos bancarios, se houver.
5. A analise e gerada no proprio navegador, sem enviar PDFs para servidor.
6. O dashboard abre com `index.html?month=AAAA-MM&source=upload&run=...`.
7. Ela pode baixar o pacote `AAAA-MM.financeiro.json`.

O importador usa PDF.js por CDN. Portanto, precisa de internet para carregar a biblioteca de leitura de PDF.

## Estrutura

- `relatorios/2026-03/`: PDFs originais de marco/2026.
- `relatorios/AAAA-MM/competencia/`: PDFs Linx por competencia, usados para faturamento, despesas, lucro, categorias e ponto de equilibrio.
- `relatorios/AAAA-MM/caixa/`: PDFs Linx por caixa, usados para conferencia bancaria.
- `relatorios/AAAA-MM/extratos/`: extratos bancarios, usados contra os relatorios por caixa.
- `dados/metricas-2026-03.js`: base consolidada usada pelo dashboard.
- `index.html`, `styles.css`, `app.js`: dashboard visual.
- `scripts/extract_pdf_text.py`: utilitario para conferir texto extraido dos PDFs.

## Premissas desta primeira versao

- JB Loja = arquivo `Relatorio La Bicyclette 03-2026 Portal Linx Menew.pdf`.
- JB Delivery = arquivo `Delivery JB - Filial 03-2026 Portal Linx Menew.pdf`.
- A aba `JB` consolida JB Loja + JB Delivery e mostra um resumo separado das duas partes.
- A aba `Barra + Leblon` consolida as duas lojas ligadas e mostra um resumo separado de cada unidade.
- Delivery sem filial deve ser tratado como Leblon em importacoes futuras.
- O importador identifica documentos por CNPJ antes de usar nome de arquivo/campo. JB Delivery Filial = `43.778.192/0002-55`.
- A parte superior do dashboard usa competencia. A conferencia bancaria usa caixa + extratos.
- Ponto de equilibrio considera CMV comida, embalagens/descartaveis, impostos e comissoes/tarifas como variaveis. Motoboy, utensilios/loucas, limpeza e materiais operacionais ficam como custos fixos/operacionais.
- O custo fixo foi estimado como `despesas operacionais - custos variaveis`.
- Distribuicao de lucros permanece nas despesas para bater com caixa/banco, mas aparece discriminada no resumo.
- No detalhe de pessoal, folha de pagamento e comissao a deduzir sao agrupadas como `Folha + comissoes`.

## Proximos ajustes

1. Confirmar os apelidos reais das categorias no Linx.
2. Separar despesas recorrentes de despesas pontuais, obras, equipamentos e distribuicao de lucros.
3. Automatizar a importacao mensal e gerar comparacao contra meses anteriores.
4. Preencher a secao `Evolucao mensal` quando houver pelo menos dois meses de dados.

## Compartilhamento com Google

O link local `http://localhost:4173` funciona apenas no computador que esta rodando o servidor.

Para compartilhar pelo ecossistema Google, ha dois caminhos:

1. **Google Drive compartilhado**
   - Bom para guardar PDFs, historico e arquivos do projeto.
   - Nao e ideal como hospedagem de site: o Drive costuma abrir `index.html` como previa/download, e nao como um app com JavaScript funcionando para todo mundo.

2. **Firebase Hosting**
   - E a opcao Google mais adequada para transformar este dashboard em um link de site.
   - Pode publicar a pasta estatica do dashboard.
   - Para dados financeiros, o ideal e adicionar controle de acesso, por exemplo Firebase Authentication com login Google ou Google Cloud Identity-Aware Proxy em uma versao mais avancada.

Fluxo recomendado: manter `relatorios/` e `dados/` em uma pasta local sincronizada com Google Drive, e publicar uma versao estatica do dashboard no Firebase Hosting quando o relatorio estiver pronto para compartilhar.
