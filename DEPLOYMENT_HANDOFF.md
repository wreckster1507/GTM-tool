# Deployment Handoff

## What This Repo Contains

- `frontend/`: React + Vite frontend
- `app/`: FastAPI backend
- `docker-compose.yml`: local/container stack for frontend + backend + Postgres
- `Dockerfile`: backend image
- `frontend/Dockerfile`: frontend image

## Runtime Architecture

- `frontend`: static React app served by Nginx
- `backend`: FastAPI application
- `worker`: Celery worker for enrichment and re-enrichment
- `beat`: Celery beat for scheduled jobs
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

Required for frontend build:

- `VITE_API_URL`

Optional provider integrations:

- `APOLLO_API_KEY`
- `HUNTER_API_KEY`
- `BUILTWITH_API_KEY`
- `INSTANTLY_API_KEY`
- `FIREFLIES_API_KEY`
- `NEWS_API_KEY`
- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`
- `CLAUDE_MODEL_SIMPLE`
- `CLAUDE_MODEL_STANDARD`
- `CLAUDE_MODEL_COMPLEX`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Quick Start With Docker

1. Copy `.env.example` to `.env`
2. Fill API keys in `.env`
3. Start the stack:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`
- Redis: `localhost:6379`
- Postgres: `localhost:5432`

## Notes For Infra / Deployment

- This branch uses Celery + Redis for background enrichment work.
- The backend queues jobs; the `worker` service processes them; `beat` handles scheduled jobs.
- Run database migrations before or during API startup:

```bash
alembic upgrade head
```

## Recommended Production Shape

- Frontend: static container or Vercel
- Backend API: container host / Azure Container Apps / App Service container
- Celery worker: separate container app / worker process
- Redis: managed Redis or containerized Redis
- Postgres: managed Postgres
