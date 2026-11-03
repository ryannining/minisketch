// RETIRED: this probe described the old <header class="topbar"> layout.
//
// That element was removed when the header became the ribbon (`.ribbon-tabs`),
// and testing/ribbon_header_probe.js now asserts the OPPOSITE: no
// <header class="topbar">, no .topbar CSS rule, and the brand / menubar / tab
// strip / status read-out / doc actions all living inside .ribbon-tabs.
//
// The menu, padlock and status assertions this file used to make were folded
// into that probe. It is kept as a stub so an existing runner that globs
// testing/*_probe.js does not report a missing file, and it always passes: the
// content it checked is either covered elsewhere or deliberately gone.
//
// Run: node testing/topbar_probe.js
console.log('topbar_probe retired — see testing/ribbon_header_probe.js');
console.log('0 failed, 0 passed (retired)');
process.exit(0);
