.PHONY: help serve clean

# Default target - list available commands
help:
	@echo "Available commands:"
	@echo "  make serve    - Start local development server on port 5173"
	@echo "  make clean    - Remove any temporary files (none currently)"
	@echo "  make help     - Show this help message"

# Start local development server
serve:
	@echo "Starting local server on http://localhost:5173"
	python3 -m http.server 5173

# Clean up any temporary files (currently none needed)
clean:
	@echo "No temporary files to clean"