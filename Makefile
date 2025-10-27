.PHONY: help serve clean build-index scenario

# Default target - list available commands
help:
	@echo "Available commands:"
	@echo "  make serve       - Start local development server on port 5173"
	@echo "  make build-index - Rebuild sample-data/scenarios/index.json from folder structure"
	@echo "  make scenario INST=<instrument-id> - Fetch and create new scenario from API"
	@echo "  make clean       - Remove any temporary files (none currently)"
	@echo "  make help        - Show this help message"

# Start local development server
serve:
	@echo "Starting local server on http://localhost:5173"
	python3 -m http.server 5173

# Clean up any temporary files (currently none needed)
clean:
	@echo "No temporary files to clean"

# Rebuild the scenarios index
build-index:
	node build-index.js

# Fetch and create a new scenario from the API
scenario:
	@echo "Fetching scenario for $(INST)"
	node fetch-scenario.js $(INST)
	make build-index