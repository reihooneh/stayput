# Stayput: the C core is built twice, natively for the tests and as WebAssembly for the site.
CC        ?= cc
CFLAGS    := -std=c17 -O2 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wdouble-promotion -Werror
SAN       := -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer
CORE      := core/maths.c core/motion.c core/rock.c core/fragility.c
WASMFLAGS := --target=wasm32 -O2 -nostdlib -ffreestanding -std=c17 \
             -Wall -Wextra -Wpedantic -Wshadow -Werror \
             -Wl,--no-entry -Wl,--initial-memory=4194304 -Wl,--max-memory=4194304 \
             -Wl,-z,stack-size=262144 -Wl,--strip-all

.PHONY: all wasm test-core lint clean

all: wasm

wasm: site/assets/stayput.wasm

site/assets/stayput.wasm: $(CORE) core/wasm.c core/stayput.h
	@mkdir -p site/assets
	clang $(WASMFLAGS) -o $@ $(CORE) core/wasm.c

build/test_core: $(CORE) tests/core/test_core.c core/stayput.h
	@mkdir -p build
	$(CC) -std=c17 -Wall -Wextra -Wpedantic -Wshadow -Werror $(SAN) -o $@ $(CORE) tests/core/test_core.c -lm

test-core: build/test_core
	./build/test_core

lint:
	$(CC) $(CFLAGS) -fsyntax-only $(CORE)
	clang-tidy $(CORE) --quiet -checks='bugprone-*,cert-*,clang-analyzer-*,-bugprone-easily-swappable-parameters,-cert-err33-c' -- -std=c17

clean:
	rm -rf build
