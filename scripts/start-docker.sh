PROJECT_FILE="docker-compose.yml"
PROJECT_NAME="freeflix"

echo "Building containers for FreeFlix..."
docker compose \
  --file "$PROJECT_FILE" \
  --project-name "$PROJECT_NAME" \
  build --no-cache db

echo "Starting containers for FreeFlix..."
docker compose \
  --file "$PROJECT_FILE" \
  --project-name "$PROJECT_NAME" \
  up -d --remove-orphans db