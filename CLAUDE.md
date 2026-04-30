# Beacon CRM — GTM Sales CRM Prototype

## What This Is
A custom GTM (go-to-market) CRM for Beacon.li — an AI implementation orchestration platform that automates enterprise SaaS deployments. This CRM replaces Clay's orchestration role and connects to external sales/enrichment APIs.

## Tech Stack
- **Backend:** Python 3.12, FastAPI, SQLModel (Pydantic + SQLAlchemy), Alembic
- **Database:** PostgreSQL 16 (use JSONB columns for flexible metadata)
- **Task Queue:** Celery + Redis (background enrichment, scheduled jobs)
- **Frontend:** React 19, Vite, TailwindCSS v4, shadcn/ui components
- **AI:** Ollama (local, Mistral 7B) for scoring, Claude API for complex reasoning
- **Infrastructure:** Docker Compose (all services in one command)

## Architecture
beacon-crm/
├── docker-compose.yml
├── Dockerfile
├── .env / .env.example
├── alembic/                  # DB migrations
├── app/                      # FastAPI backend
│   ├── main.py               # App entry + CORS + router includes
│   ├── celery_app.py         # Celery config
│   ├── config.py             # Pydantic Settings (reads .env)
│   ├── database.py           # Async engine + session
│   ├── models/               # SQLModel table classes
│   ├── routes/               # FastAPI routers (one per resource)
│   ├── services/             # Business logic (scoring, enrichment, health)
│   ├── clients/              # External API wrappers (apollo, hunter, etc.)
│   └── tasks/                # Celery tasks
└── frontend/                 # React app
└── src/
├── pages/
├── components/
└── lib/api.ts        # Typed fetch wrappers

## Commands
- `docker compose up --build` — Start all services
- `docker compose exec web alembic upgrade head` — Run migrations
- `docker compose exec web pytest` — Run tests
- `cd frontend && npm run dev` — Frontend dev server
- `cd frontend && npm run build` — Production build

## Coding Rules
- Use async/await for all database operations and API calls
- Every route returns Pydantic response models (never raw dicts)
- Use SQLModel for all models (NOT raw SQLAlchemy)
- JSONB columns for flexible fields: qualification, metadata, enrichment_sources
- Celery tasks for anything that takes >2 seconds (enrichment, AI calls)
- All external API calls go through client classes in app/clients/
- Frontend: functional components, TypeScript, named exports
- Frontend: use shadcn/ui components, NOT custom component libraries

## IMPORTANT
- NEVER hardcode API keys. Always use environment variables via app/config.py
- NEVER skip Alembic migrations. Every model change needs a migration.
- Always create .env.example with placeholder values when adding new env vars
- The frontend and backend run on separate ports (3000 and 8000). Configure CORS.
- Use UUID primary keys everywhere (not auto-increment integers)

