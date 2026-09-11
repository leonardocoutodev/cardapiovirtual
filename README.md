# Talvi

**Talvi** é o produto de cardápio/vitrine gastronômica e gestão de pedidos da LC Soluções Digitais.

Este repositório preserva o snapshot técnico do produto anteriormente identificado como **LC Menu Pro / Cardápio Virtual** e reúne os componentes específicos que também integram o ecossistema LCAI:

- interface e assets do cardápio;
- portal do proprietário;
- API específica do proprietário;
- estrutura de banco de dados e migrations do Supabase;
- recomendações/cross-sell e adicionais;
- analytics;
- integração comercial/Eduzz;
- testes automatizados do módulo.

## Migração de marca

A marca pública passa a ser **Talvi**.

Durante a migração, identificadores técnicos existentes como `menu-pro`, `menu_pro`, nomes de migrations, rotas, tabelas e arquivos podem permanecer temporariamente para preservar compatibilidade com banco, APIs, testes e integrações já implantadas. Eles não devem ser usados como nome comercial em novas interfaces ou materiais.

Novos componentes devem usar `talvi` como identificador quando isso não exigir quebra de compatibilidade. A substituição dos aliases legados será feita gradualmente, com redirecionamentos e testes de regressão.

## Origem do snapshot

Fonte: `leonardocoutodev/LCAI`  
Branch de origem do snapshot inicial: `main`  
Data do snapshot inicial: 06/09/2026.

> O LCAI continua sendo a fonte integrada do ecossistema. Este repositório funciona como cópia versionada dos componentes específicos do Talvi enquanto a separação arquitetural é amadurecida.

## Estrutura atual

- `public/` — interface e assets.
- `src/menu-pro-owner-api.ts` — API do portal do proprietário; nome técnico legado mantido por compatibilidade.
- `supabase/migrations/` — schema e evolução do banco; migrations históricas não devem ser renomeadas.
- `test/` — testes específicos do produto; nomes legados serão migrados de forma incremental.

## Segurança

Nenhuma chave secreta, token ou credencial privada deve ser versionada neste repositório.
