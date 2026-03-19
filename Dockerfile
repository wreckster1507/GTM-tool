FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Strip Windows CRLF line endings from shell scripts (safe no-op on Linux sources)
RUN sed -i 's/\r//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000
