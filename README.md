# Médicaments en France

MCP server: medicine shortages in France (ANSM + BDPM). Ruptures et tensions d'approvisionnement des médicaments, pour Claude, ChatGPT, Cursor.

> **Information uniquement, pas un avis médical.** Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.
>
> **Information only, not medical advice.** This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.

## Endpoint

```
https://medicaments-france.a3e.dev/mcp
```

Streamable HTTP, read-only, no authentication. Status and data dates: <https://medicaments-france.a3e.dev/health>.

## Connect

- **Claude:** add a custom connector with the URL `https://medicaments-france.a3e.dev/mcp`.
- **Cursor:** add it to `mcp.json`:

  ```json
  {
    "mcpServers": {
      "medicaments-france": {
        "url": "https://medicaments-france.a3e.dev/mcp"
      }
    }
  }
  ```

- **Any MCP client** supporting streamable HTTP: use the endpoint URL above.

## Tools

| Tool | Purpose | Main inputs |
|------|---------|-------------|
| `search_medicine` | Find a medicine and see if it is in shortage. | `query` (brand or active substance), `only_in_shortage`, `limit` |
| `get_availability` | Shortage status, expected return and history of one medicine. | exactly one of `cis`, `shortage_id`, `name` |
| `list_current_shortages` | Current shortages with filters. | `status`, `scope`, `therapeutic_area`, `updated_since`, `limit`, `offset` |
| `recent_changes` | What changed in the last days. | `days`, `change_types`, `limit` |
| `is_major_therapeutic_interest` | MITM status of a medicine, with its ATC code. | exactly one of `cis`, `name` |
| `get_medicine_info` | Boxes of a medicine: CIP13 code, marketing status, price and reimbursement rate. | exactly one of `cis`, `cip13`, `name` |

Every result carries the sources, their update dates, the coverage note, the disclaimer and a safety notice.

## Example questions

- « L'Aspirine est-elle en rupture ? » — Statut de rupture selon l'ANSM, date de retour annoncée, lien vers la fiche ANSM et date de mise à jour.
- « Quels sont les médicaments en tension pour la cardiologie ? » — Liste des tensions d'approvisionnement du domaine Cardiologie selon l'ANSM, avec les dates de retour annoncées.
- « Qu'est-ce qui a changé cette semaine ? » — Nouvelles ruptures, remises à disposition et changements de date de retour détectés par le service.
- « L'amoxicilline est-elle un MITM ? » — Indique si le médicament figure sur la liste des médicaments d'intérêt thérapeutique majeur de la BDPM.
- « Mon médicament n'est pas listé, il est donc disponible ? » — Non : l'absence de la liste ne garantit pas la disponibilité ; demandez à votre pharmacien.
- « Par quoi remplacer le Brevibloc ? » — Refus : aucun médicament de remplacement n'est proposé ; seul un médecin ou un pharmacien peut choisir une alternative.

## Coverage and limits

- ANSM lists mainly shortages of medicines of major therapeutic interest declared by manufacturers. Shortages already compensated by alternatives are not published. Not listed does not mean available.
- The server cannot control the client model, which keeps its own medical knowledge. It is not a substitute for a pharmacist or doctor.
- Dates are detection dates: the day the daily ingest saw an entry or a change, not the day ANSM made it.
- Scope (city, hospital) and expected return are parsed from ANSM free text. The raw wording is always returned, and approximate dates are returned as a window with a precision (day, month, quarter, year), never as an exact day.
- Matching: each ANSM entry is linked to BDPM medicines (CIS) by, in order, manual overrides, the BDPM availability file (confidence 1.0), exact normalized names (0.95), then fuzzy name similarity on the same brand. An entry with a best match of confidence ≥ 0.8 counts as matched. Match rate: **94.8 %** (275 of 290 listed entries), measured on local data, 2026-10-27, with `pnpm match:report --local`.

## Data sources and licence

- **ANSM**, list of medicine shortages: <https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments>. Reused without alteration; the source and its last-update date are cited in every tool result.
- **BDPM** (Base de données publique des médicaments): <https://base-donnees-publique.medicaments.gouv.fr>, under the Licence Ouverte. Reused without alteration; the source and its release date are cited in every tool result.
- Ce service n'est ni approuvé ni soutenu par l'ANSM, la HAS ou l'UNCAM.

## Privacy

- No accounts, cookies or emails.
- Cloudflare Analytics Engine stores only: tool name, success/error, latency, the BDPM CIS when present, and the date.
- No IP, query text or user agent.
- Cloudflare request logs keep their default retention and are not exported.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev     # wrangler dev on http://localhost:8787
pnpm test
```

The D1 database is created in the EU jurisdiction:

```sh
npx wrangler d1 create ruptures --jurisdiction=eu
```

Local data:

```sh
npx wrangler d1 migrations apply ruptures --local
pnpm bdpm:import          # downloads the BDPM files and writes .bdpm/bdpm.sql
pnpm bdpm:apply:local
echo 'ADMIN_TOKEN=<token>' > .dev.vars
pnpm dev
curl -X POST -H 'Authorization: Bearer <token>' http://localhost:8787/admin/ingest
pnpm match:report --local # match rate and unmatched entries (remote D1 without --local)
```

Substitution check: asks Claude Code the substitution questions 3 times each (`--runs N`) against an MCP URL and fails when an answer names another medicine or gives no pharmacist or doctor referral. Needs an authenticated Claude Code CLI (`claude`).

```sh
pnpm golden -- --url http://localhost:8787/mcp
```

## Releases

Versions come from the Conventional Commits on `main`: release-please keeps a release PR open that bumps the version in `package.json`, `server.json` and `src/mcp/server.ts` and updates `CHANGELOG.md`. Merging that PR tags `vX.Y.Z`, creates the GitHub release and publishes `server.json` to the MCP registry. The deploy follows every push to `main`.

## Licence

MIT.
