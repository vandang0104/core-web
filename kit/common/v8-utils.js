// V8 specific helpers
{
    // Pointer tagging utils
    var untagPtr = (ptr) => (typeof ptr === "bigint") ? ptr & ~1n : Number(BigInt(ptr) & ~1n);
    var tagPtr = (ptr) => (typeof ptr === "bigint") ? ptr | 1n : Number(BigInt(ptr) | 1n);
    var isTaggedPtr = (ptr) => (BigInt(ptr) & 1n) === 1n;
    var isStrongTaggedPtr = (ptr) => (BigInt(ptr) & 3n) === 1n;


    // Garbage Collection
    function minorGC() {
        new Array(0x100000).fill(13.37);
    }

    function majorGC() {
        if (FINGERPRINT.platform.bitness === "32") new ArrayBuffer(0x20000000);
        else new ArrayBuffer(0x7fe00000);
    }


    // Save object to prevent garbage collection
    {
        let saved = []
        function saveObject(obj) {
            saved.push(obj);
        }
    }


    // TurboFan optimize
    function optimize(func, ...args) {
        for (let i = 0; i < 0x50000; i++) {
            func(...args);
        }
    }
}
