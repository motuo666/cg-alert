    .PHONY: setup dev test build deploy health
    setup:
	@if [ -f package.json ]; then npm ci; fi

    dev:
	@if [ -f package.json ]; then npm run dev; fi

    test:
	@if [ -f package.json ]; then npm test --if-present; fi

    build:
	@if [ -f package.json ]; then npm run build --if-present; fi

    deploy:
	@echo "Use GitHub Actions deploy-cloudflare.yml to deploy"

    health:
	@if [ -f package.json ]; then npm run health --if-present || echo "Add a health script"; fi
