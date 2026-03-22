# Deployment Handoff

## What This Repo Contains

- `frontend/`: React + Vite frontend
- `app/`: FastAPI backend
- `app/celery_app.py`: Celery app configuration
- `app/tasks/`: Background workers for enrichment and health jobs
- `docker-compose.yml`: local/container stack for backend API + Celery worker + Redis + Postgres
- `Dockerfile`: shared image for the API and worker

## Runtime Architecture

- `api`: FastAPI application
- `worker`: Celery worker for account sourcing and enrichment jobs
- `redis`: Celery broker/result backend
- `postgres`: application database

## Backend Endpoints To Return After Deployment

- Backend base URL: `https://<backend-host>`
- Health: `https://<backend-host>/health`
- Swagger docs: `https://<backend-host>/docs`
- OpenAPI schema: `https://<backend-host>/openapi.json`

## Frontend Endpoint To Return After Deployment

- Frontend app URL: `https://<frontend-host>`

## Environment Variables

Required for backend:

- `DATABASE_URL`
- `SYNC_DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `ENVIRONMENT`
- `CORS_ORIGINS`

Optional provider integrations:

- `APOLLO_API_KEY`
- `HUNTER_API_KEY`
- `BUILTWITH_API_KEY`
- `INSTANTLY_API_KEY`
- `FIREFLIES_API_KEY`
- `NEWS_API_KEY`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION`
- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Quick Start With Docker

1. Copy `.env.example` to `.env`
2. Fill API keys in `.env`
3. Start the backend stack:

```bash
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

## Notes For Infra / Deployment

- The API and worker should use the same image and the same environment variables.
- Celery must point to a live Redis instance through `REDIS_URL`.
- The API is not the worker; long-running account sourcing and enrichment tasks are executed by Celery.
- Run database migrations before or during API startup:

```bash
alembic upgrade head
```

## Recommended Production Shape

- Frontend: Vercel or static hosting
- Backend API: container host / Azure Container Apps / App Service container
- Celery worker: separate container/service
- Redis: managed Redis
- Postgres: managed Postgres
