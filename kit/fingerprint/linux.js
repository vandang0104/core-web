// Check if the browser sandbox is enabled (using getpid syscall)
{
    if (FINGERPRINT.platform.os === "Linux" && FINGERPRINT.platform.arch === "x64") {
        let pid = syscall(39n);  // getpid()
        if (pid !== 1n) {
            FINGERPRINT.process.sandboxed = false;
            log("[+] Sandbox is disabled", 1);
        } else {
            FINGERPRINT.process.sandboxed = true;
            log("[i] Sandbox is enabled", 1);
        }
    }
}
