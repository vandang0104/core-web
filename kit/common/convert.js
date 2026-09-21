// Conversion utils
{
    // Int / BigInt -> Hex string
    var hex = (val) => val.toString(16);


    // Int <-> Float utils
    {
        let conv_buf = new ArrayBuffer(8);
        let conv_float = new Float64Array(conv_buf);
        let conv_i32 = new Uint32Array(conv_buf);
        let conv_i64 = new BigUint64Array(conv_buf);

        function f2il(v) {
            conv_float[0] = v;
            return conv_i32[0];
        }

        function f2ih(v) {
            conv_float[0] = v;
            return conv_i32[1];
        }

        function f2bi(v) {
            conv_float[0] = v;
            return conv_i64[0];
        }

        function i2f(l, h) {
            conv_i32[0] = l;
            conv_i32[1] = h;
            return conv_float[0];
        }

        function bi2f(v) {
            conv_i64[0] = v;
            return conv_float[0];
        }
    }


    // Int <-> Byte array
    var i16arr = (n) => {
        let buf = new ArrayBuffer(2);
        let arr = new Int8Array(buf);
        let view = new DataView(buf);

        view.setUint16(0, n, true);
        return Array.from(arr);
    }

    var i32arr = (n) => {
        let buf = new ArrayBuffer(4);
        let arr = new Int8Array(buf);
        let view = new DataView(buf);

        view.setUint32(0, n, true);
        return Array.from(arr);
    }

    var i64arr = (n) => {
        let buf = new ArrayBuffer(8);
        let arr = new Int8Array(buf);
        let view = new DataView(buf);

        view.setBigUint64(0, BigInt(n), true);
        return Array.from(arr);
    }


    // String <-> Byte array
    var stringToArr = (str) => Array.from(str, (x) => x.charCodeAt(0)).concat([0]);
    var stringToArrUtf16 = (str) => Array.from(str, (x) => [x.charCodeAt(0), 0]).flat().concat([0,0]);
    var arrToString = (arr) => Array.from(arr, (x) => x > 0 ? String.fromCharCode(x) : "" ).join("");


    // Other int conversion utils
    {
        const i64ToU64Offset = 2n**64n;

        // Convert signed BigInt to unsigned BigInt
        function ui64(signedBigInt) {
            return signedBigInt < 0 ? i64ToU64Offset + signedBigInt : signedBigInt;
        }
    }
}
