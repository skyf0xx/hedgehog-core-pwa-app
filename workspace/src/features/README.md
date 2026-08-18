# Features

Empty until the first domain module is generated. A module lands here as
`src/features/{module}/`, built by this core's five-layer sequence
(`schema -> repository -> hook -> screen -> join`, see `../../core.yaml`):

```
src/features/{module}/
├── data/
│   ├── {module}.schema.ts        Zod schema for the module's entity
│   ├── {module}.repository.ts    the only file allowed to import src/db/**
│   └── ...
├── hooks/
│   └── use-{module}.ts           React hooks wrapping the repository
├── components/
│   └── ...                       feature-local UI
└── index.ts                      the module's public barrel — the only
                                   valid import path from outside the
                                   feature (@/features/{module})
```

Cross-feature imports go through `index.ts` only — no deep import into
another feature's `data/`, `hooks/`, or `components/` (enforced by
`../../eslint.config.mjs`). A feature never imports `src/db/**` directly
except from its own `data/*.repository.ts`, and never imports a provider
SDK directly except through `../integrations/*/[name].client.ts`.
