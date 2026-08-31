# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
npm install
```

**Note**: feel free to use the package manager of your choice.

## Local Development

Like the build (see below), `npm run start` needs the OpenAPI spec exported
first — it generates the API reference before starting the dev server, and
fails without it:

```bash
# from the repo root, once (or whenever the API changes)
npm run sdk:export-spec

# then, inside website/
npm run start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

This site's build pulls in the OpenAPI spec from `../sdk/openapi.json`,
which is gitignored and not committed. Export it fresh from the repo root
before building:

```bash
# from the repo root
npm run sdk:export-spec

# then, inside website/
npm install && npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

This site deploys automatically via `.github/workflows/docs.yml` on every
push to `main` that touches `website/**` or `lib/openapi/email-inboxes.ts`.
Do not run `docusaurus deploy` manually — there is no `gh-pages` branch.
