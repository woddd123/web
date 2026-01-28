const fixEncoding = (str) => {
  console.log(`Original: ${str}`);
  console.log(`Codes: ${str.split('').map(c => c.charCodeAt(0))}`);

  // 1. Pure ASCII
  if (/^[\x00-\x7F]*$/.test(str)) {
    console.log('ASCII detected');
    return str;
  }

  // 2. Check for > 255
  if (/[^\x00-\xFF]/.test(str)) {
    console.log('Chars > 255 detected');
    // return str; // COMMENTED OUT TO TEST FORCE CONVERSION
  }

  // 3. Latin1 -> UTF8
  try {
    const bytes = Buffer.from(str, 'latin1');
    const decoded = bytes.toString('utf8');
    console.log(`Decoded: ${decoded}`);
    return decoded;
  } catch (e) {
    console.error(e);
    return str;
  }
};

// Simulate "中文" (E4 B8 AD E6 96 87) interpreted as Latin1
// U+00E4 U+00B8 U+00AD U+00E6 U+0096 U+0087
const mojibake = String.fromCharCode(0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87);
console.log('--- Test 1: Mojibake ---');
fixEncoding(mojibake);

// Simulate "Hello"
console.log('\n--- Test 2: ASCII ---');
fixEncoding("Hello");

// Simulate "Already Correct 中文"
console.log('\n--- Test 3: Correct ---');
fixEncoding("中文");
