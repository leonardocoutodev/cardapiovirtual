# Cardápio Virtual — LC Menu Pro

Snapshot do projeto **LC Menu Pro / Cardápio Virtual** mantido pela LC Soluções Digitais.

Este repositório guarda os componentes específicos do cardápio que atualmente também integram o ecossistema LCAI:

- interface e assets do cardápio;
- portal do proprietário;
- API específica do proprietário;
- estrutura de banco de dados e migrations do Supabase;
- recomendações/cross-sell e adicionais;
- analytics;
- integração comercial/Eduzz;
- testes automatizados do módulo.

## Origem do snapshot

Fonte: `leonardocoutodev/LCAI`  
Branch de origem: `main`  
Data do snapshot: 06/09/2026.

> O LCAI original permanece inalterado. Este repositório funciona como cópia versionada dos componentes específicos do Cardápio Virtual. Partes administrativas que ainda vivem no núcleo monolítico do LCAI não foram copiadas integralmente para evitar trazer código de outros produtos.

## Estrutura

- `public/` — interface e assets.
- `src/menu-pro-owner-api.ts` — API do portal do proprietário.
- `supabase/migrations/` — schema e evolução do banco.
- `test/` — testes específicos do Menu Pro.

## Segurança

Nenhuma chave secreta, token ou credencial privada deve ser versionada neste repositório.
