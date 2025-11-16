    .PHONY: setup health harvest outreach intake bounce suppress enrich discover expand pricing legal
    setup:
	npm ci

    health:
	npm run health

    harvest:
	npm run harvest

    outreach:
	npm run outreach

    intake:
	npm run intakeSync

    bounce:
	npm run bounce

    suppress:
	npm run suppress

    enrich:
	npm run enrich

    discover:
	npm run discoverTargets

    expand:
	npm run expandEndpoints

    pricing:
	npm run pricingSync

    legal:
	npm run legalStamp
