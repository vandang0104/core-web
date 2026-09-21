// Fingerprint browser and platform on Windows (by parsing KernelBase.dll and the main browser executable)
// Check if the browser sandbox is enabled (using IsProcessInJob())
{
    if (FINGERPRINT.platform.os === "Windows" && FINGERPRINT.platform.arch === "x64") {
        // Retrieve Windows build number from KernelBase.dll
        let kernelbase_dll = getBaseAddr("KERNELBASE.dll");
        FINGERPRINT.platform.os_version = getPEVersion(kernelbase_dll);
        log("[+] Fingerprinted OS version: " + FINGERPRINT.platform.os_version, 1);


        // Find browser version from main executable PE data
        // Support the following browsers: Google Chrome, Chromium, Google Chrome for Testing, Microsoft Edge, Brave, Opera
        let browser_base;
        if ((browser_base = getBaseAddr("chrome.exe", false)) > 0) {
            let browser_name = getPEVersion(browser_base, "FileDescription");
            FINGERPRINT.browser.name = browser_name;
        } else if ((browser_base = getBaseAddr("msedge.exe", false)) > 0) {
            FINGERPRINT.browser.name = "Microsoft Edge";
        } else if ((browser_base = getBaseAddr("brave.exe", false)) > 0) {
            FINGERPRINT.browser.name = "Brave";
        } else if ((browser_base = getBaseAddr("opera.exe", false)) > 0) {
            FINGERPRINT.browser.name = "Opera";
        }

        if (typeof browser_base !== "undefined" && browser_base > 0x0n) {
            let version = getPEVersion(browser_base);
            [
                FINGERPRINT.browser.browser_version.major,
                FINGERPRINT.browser.browser_version.minor,
                FINGERPRINT.browser.browser_version.build,
                FINGERPRINT.browser.browser_version.patch
            ] = version.split('.').map(Number);
            log(`[+] Fingerprinted browser: ${FINGERPRINT.browser.name} ${version}`, 1);

            let chromium_version = getBrowserToChromiumVersion(FINGERPRINT.browser.name, version);
            if (typeof chromium_version !== "undefined") {
                [
                    FINGERPRINT.browser.chromium_version.major,
                    FINGERPRINT.browser.chromium_version.minor,
                    FINGERPRINT.browser.chromium_version.build,
                    FINGERPRINT.browser.chromium_version.patch
                ] = chromium_version.split('.').map(Number);
                log(`[+] Corresponding Chromium version: ${chromium_version}`, 2);

            } else if (["Microsoft Edge", "Brave"].includes(FINGERPRINT.browser.name)) {
                FINGERPRINT.browser.chromium_version.major = FINGERPRINT.browser.browser_version.major;
            }
        } else {
            log(`[-] Unable to fingerprint browser (not Chrome / Edge / Brave / Opera)`);
        }


        // Check if the current process is sandboxed
        let is_process_in_job = getExportAddr(kernelbase_dll, "IsProcessInJob");
        let res_addr = getDataAddr([0]);
        let status = callNativeFunction(kernelbase_dll + is_process_in_job, 0xffffffffffffffffn, 0n, res_addr);
        if (status !== 0 && !getBigUint(res_addr, 1)) {
            FINGERPRINT.process.sandboxed = false;
            log("[+] Sandbox is disabled", 1);
        } else {
            FINGERPRINT.process.sandboxed = true;
            log("[i] Sandbox is enabled", 1);
        }
    }
}
