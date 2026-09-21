// Fingerprint target browser using the navigator.userAgentData property
// Implement basic checks to defeat user-agent spoofing
// NB: because of restrictions on User-Agent Client Hints, this fingerprinting method only works in secure contexts (HTTPS / localhost)
{
    if (typeof navigator === "object") {
        // Get UserAgent data with high entropy values
        // Add checks to ensure that navigator.userAgentData is a valid NavigatorUAData (which exists only on Chromium)
        let getUA = async () => {
            let value;
            if (typeof navigator.userAgentData !== "undefined"
                && typeof NavigatorUAData !== "undefined"
                && navigator.userAgentData instanceof NavigatorUAData
                && typeof navigator.userAgentData.getHighEntropyValues === "function") {
                try {
                    value = await navigator.userAgentData.getHighEntropyValues(
                        ["architecture", "bitness", "formFactors", "fullVersionList",
                            "model", "platformVersion", "uaFullVersion", "wow64"]);
                    postMessage(value);
                    return value
                } catch { }
            }
            postMessage(-1);
            return -1;
        };


        // Parse UserAgent data & try to detect spoofed user-agent
        let parseUA = (useragent) => {
            assert(useragent !== -1, "[-] Target browser does not look like Chromium (or Client Hints unavailable due to an insecure context)");
            log("[i] Extracted user-agent data:", 3);
            Object.entries(useragent).forEach(([key, val]) => log(`    - ${key}: ${JSON.stringify(val)}`, 3));

            let spoofedlog = "[-] Chromium identified, but spoofed user-agent detected: skipping user-agent fingerprinting";
            if (useragent.brands.length !== useragent.fullVersionList.length || useragent.brands.length < 2) {
                log(spoofedlog, 1);
                return;
            }

            let browser_name, browser_major, browser_minor, browser_build, browser_patch;
            let chromium_major, chromium_minor, chromium_build, chromium_patch;
            for (let i = 0; i < useragent.brands.length; i++) {
                let brand = useragent.brands[i];
                let fullversion = useragent.fullVersionList[i];
                let [major, minor, build, patch] = fullversion.version.split('.').map(Number);

                if (brand.brand !== fullversion.brand || brand.version !== major.toString()) {
                    log(spoofedlog, 1);
                    return;
                }

                else if (/[\W_]?Not[\W_]A[\W_]Brand[\W_]?/.test(brand.brand)) {
                    if (brand.version === major.toString() && minor === 0 && build === 0 && patch === 0 ) {
                        continue;
                    } else {
                        log(spoofedlog, 1);
                        return;
                    }
                }

                else if (brand.brand === "Chromium") {
                    chromium_major = major;

                    if (minor === 0 && build === 0 && patch === 0) {
                        log("[-] Unable to retrieve full Chromium version", 2);
                    } else {
                        chromium_minor = minor;
                        chromium_build = build;
                        chromium_patch = patch;
                    }
                }

                else if (useragent.uaFullVersion === fullversion.version) {
                    browser_name = brand.brand;
                    browser_major = major;

                    if (minor === 0 && build === 0 && patch === 0) {
                        log("[-] Unable to retrieve full browser version", 2);
                    } else {
                        browser_minor = minor;
                        browser_build = build;
                        browser_patch = patch;
                    }
                }

                else {
                    log(`[-] Unknown brand: ${fullversion.brand} ${fullversion.version}`, 2);
                    continue;
                }
            }

            if (typeof browser_name === "undefined" && navigator.userAgent.includes(" Electron/")) {
                browser_name = "Electron";
                let electron_version = navigator.userAgent.match(/Electron\/(\d+\.\d+\.\d+)/)?.[1] ?? "";
                [browser_major, browser_minor, browser_build, browser_patch] = electron_version.split('.').map(Number);
                let app_name = navigator.userAgent.match(/[^\s/]+\/[\d.]+(?=\s+Chrome)/)?.[0];
                log(`[i] Electron-based application detected: ${app_name}`, 2);
            }

            FINGERPRINT.browser.name = browser_name;
            FINGERPRINT.browser.browser_version.major = browser_major;
            FINGERPRINT.browser.browser_version.minor = browser_minor;
            FINGERPRINT.browser.browser_version.build = browser_build;
            FINGERPRINT.browser.browser_version.patch = browser_patch;

            FINGERPRINT.browser.chromium_version.major = chromium_major;
            FINGERPRINT.browser.chromium_version.minor = chromium_minor;
            FINGERPRINT.browser.chromium_version.build = chromium_build;
            FINGERPRINT.browser.chromium_version.patch = chromium_patch;

            FINGERPRINT.platform.bitness = useragent.bitness;
            if (useragent.wow64) FINGERPRINT.platform.bitness = "32";

            if (useragent.architecture === "x86" && useragent.bitness === "64" && !useragent.wow64) {
                FINGERPRINT.platform.arch = "x64";

            } else if (useragent.architecture === "" && useragent.platform === "Android")  {
                FINGERPRINT.platform.arch = "arm64";  // assuming architecture for android devices

            } else {
                FINGERPRINT.platform.arch = useragent.architecture;
            }

            FINGERPRINT.platform.os = useragent.platform;
            FINGERPRINT.platform.os_version = useragent.platformVersion;
            FINGERPRINT.platform.device = useragent.model;

            let nice_browser_version = typeof browser_minor === "undefined" ? `${browser_major}` : `${browser_major}.${browser_minor}.${browser_build}.${browser_patch}`
            let nice_chromium_version = typeof chromium_minor === "undefined" ? `${chromium_major}` : `${chromium_major}.${chromium_minor}.${chromium_build}.${chromium_patch}`
            log(`[+] Fingerprinted target browser from its user-agent: ${FINGERPRINT.browser.name} (${nice_browser_version}) / Chromium (${nice_chromium_version}) on ${FINGERPRINT.platform.os} (${FINGERPRINT.platform.os_version} ${FINGERPRINT.platform.arch})`, 1);
        }


        // Run getUA() in a worker (defeat most of user-agent spoofing extensions)
        let blob = new Blob([`(${getUA.toString()})();`], {type: "application/javascript"});
        let worker = new Worker(URL.createObjectURL(blob));

        new Promise((resolve, reject) => {
            worker.onerror = (e) => {
                reject();
            }

            worker.onmessage = (e) => {
                let useragent = e.data;
                try {
                    parseUA(useragent);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }
        });
    }
}
