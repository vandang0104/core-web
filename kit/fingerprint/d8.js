// Fingerprint d8 (for development & debugging purposes)
{
    if (typeof version === "function" && typeof os === "object" && os.hasOwnProperty("d8Path")) {
        let v8_version = version();
        let [major, minor, build, patch] = v8_version.split('.').map(Number);

        FINGERPRINT.browser.name = "d8";
        FINGERPRINT.browser.browser_version.major = major;
        FINGERPRINT.browser.browser_version.minor = minor;
        FINGERPRINT.browser.browser_version.build = build;
        FINGERPRINT.browser.browser_version.patch = patch;

        let chromium_version = major * 10 + minor;
        FINGERPRINT.browser.chromium_version.major = chromium_version;

        if (os.name === "unknown") {                // there is a bug on Windows builds leading to os.name="unknown"
            FINGERPRINT.platform.os = "Windows";
        } else {
            FINGERPRINT.platform.os = os.name[0].toUpperCase() + os.name.slice(1);
        }

        // Assuming x86 / x64, check for bitness using max ArrayBuffer length
        FINGERPRINT.platform.arch = "x64";
        FINGERPRINT.platform.bitness = "64";
        try {
            new ArrayBuffer(2**31);
        } catch (err) {
            if (err instanceof RangeError && err.message === "Invalid array buffer length") {
                FINGERPRINT.platform.arch = "x86";
                FINGERPRINT.platform.bitness = "32";
            }
        }

        log(`[+] Detected d8 ${v8_version} (Chromium ${chromium_version}) on ${FINGERPRINT.platform.os} ${FINGERPRINT.platform.arch}`, 1);
    }
}
