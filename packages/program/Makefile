.PHONY: check fmt lint test build run clean all fix-all

# Default target
all: check test build

# Check code formatting
check:
	cargo fmt --all -- --check

# Format code
fmt:
	cargo fmt --all

# Run clippy
lint:
	cargo clippy -- -D warnings

# Run tests
test:
	anchor run test

# Build all binaries
build:
	cargo build --workspace

# Clean build artifacts
clean:
	anchor clean

test-local:
	./scripts/install.sh
	./scripts/test.local.sh

# Run all fixes and checks
lint-fix-all:
	cargo clippy --fix -- -D warnings
	cargo fmt --all
	cargo fmt --all -- --check