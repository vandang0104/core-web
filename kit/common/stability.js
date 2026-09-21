// Utils related to exploit stability
{
    // Assert utils
    function assert(condition, msg="Assertion error", maxtries=3, reload=false) {
        if (!condition) {
            RETRY = maxtries;
            RELOAD = reload;
            throw Error(msg);
        }
    }

    function assertTry(func, msg, maxtries=3, reload=false) {
        try {
            func();
        } catch (error) {
            RETRY = maxtries;
            RELOAD = reload;
            throw Error(`${msg} (${(error.message ? error.message : error)})`);
        }
    }


    // Register cleaner functions to be executed automatically on exit or reload
    // Intermediate cleaning can be achieved by giving a class name to the cleaner and calling clean(name) later
    let clean_funcs = {}

    function cleaner(func, name="") {
        if (!clean_funcs.hasOwnProperty(name)) {
            clean_funcs[name] = [];
        }
        clean_funcs[name].push(func);
    }

    function clean(name="") {
        if (name !== "" && clean_funcs.hasOwnProperty(name)) {
            for (const func of clean_funcs[name]) {
                try {
                    func();
                } catch (e) {
                    log(e);
                }
            }
            clean_funcs[name] = [];
        } else if (name === "") {
            log("[i] Running all registered memory cleaners");
            for (const func of Object.values(clean_funcs).flat() ) {
                try {
                    func();
                } catch (e) {
                    log(e);
                }
            }
            clean_funcs = {};
        }
    }
}
