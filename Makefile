    .PHONY: setup dev test build deploy
    setup:
	@if [ -f package.json ]; then npm ci; fi

    dev:
	@if [ -f package.json ]; then npm run dev; fi

    test:
	@if [ -f package.json ]; then npm test --if-present; fi

    build:
	@if [ -f package.json ]; then npm run build --if-present; fi

    deploy:
	@echo "Implement deployment pipeline"
