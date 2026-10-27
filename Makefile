# Local development defaults; they match .env.example and docker-compose.yml.
MONGO_URI ?= mongodb://tcg:tcg@localhost:27017
RABBITMQ_URL ?= amqp://tcg:tcg@localhost:5672
ADMIN_ALERT_EMAILS ?= admin@tcgstore.local
export MONGO_URI RABBITMQ_URL ADMIN_ALERT_EMAILS

.PHONY: install run test

install:
	npm install

run:
	npm run dev

test:
	npm test
