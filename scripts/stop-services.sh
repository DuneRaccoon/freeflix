PROJECT_FILE="docker-compose.yml"
PROJECT_NAME="freeflix"

# Shift off the first argument so any extra arguments can be passed to 'down'
shift

echo "Stopping Freeflix environment..."

# Check if there are running containers before attempting to stop.
RUNNING_CONTAINERS=$(docker compose -f "$PROJECT_FILE" --project-name "$PROJECT_NAME" ps -q)
if [ -n "$RUNNING_CONTAINERS" ]; then
  docker compose --file "$PROJECT_FILE" --project-name "$PROJECT_NAME" down "$@"
  echo "Freeflix environment has been stopped."
else
  echo "Error: Freeflix environment is not running."
  exit 1
fi
