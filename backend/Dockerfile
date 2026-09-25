FROM python:3.11-slim
WORKDIR /app/backend
COPY pyproject.toml ./
COPY recon ./recon
COPY api ./api
RUN pip install --no-cache-dir -e ".[dev]"
COPY . .
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
