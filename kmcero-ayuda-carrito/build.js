/**
 * Script de compilación — genera dist/content.js ofuscado con licencia.
 * Uso: node build.js [--secret MI_CLAVE]
 *
 * Si no pasas --secret, usa la variable de entorno KMCERO_SECRET.
 * NUNCA hardcodees la clave secreta aquí.
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ─── Clave secreta ────────────────────────────────────────────────────────────
// Leer de argumento --secret o variable de entorno
let secret = process.env.KMCERO_SECRET || '';
const secretIdx = process.argv.indexOf('--secret');
if (secretIdx !== -1 && process.argv[secretIdx + 1]) {
  secret = process.argv[secretIdx + 1];
}
if (!secret) {
  console.error('\n❌ ERROR: Debes proporcionar la clave secreta.');
  console.error('   Uso: node build.js --secret TU_CLAVE_SECRETA');
  console.error('   O:   set KMCERO_SECRET=TU_CLAVE_SECRETA && node build.js\n');
  process.exit(1);
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
const SRC = path.join(__dirname, 'content.js');
const DIST = path.join(__dirname, 'dist', 'content.js');

// ─── Leer versión del manifest ────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const version = manifest.version;
const year = new Date().getFullYear();

// ─── Bloque de licencia ───────────────────────────────────────────────────────
const LICENSE = `/*!
 * KMCERO · Ayuda para el carrito  v${version}
 * Copyright (c) ${year} — Todos los derechos reservados.
 *
 * LICENCIA DE USO PERSONAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Este software se distribuye exclusivamente para uso personal del usuario
 * final que lo recibe. Queda expresamente PROHIBIDO:
 *
 *   1. Copiar, modificar, fusionar, publicar o distribuir este software
 *      o cualquier versión derivada, con o sin fines comerciales.
 *   2. Vender, sublicenciar o ceder el software a terceros.
 *   3. Realizar ingeniería inversa, desofuscar o intentar recuperar el
 *      código fuente original con fines de redistribución o copia.
 *   4. Usar el software en herramientas automatizadas que no sean el
 *      navegador personal del usuario.
 *
 * Este software se proporciona "TAL CUAL", sin garantías de ningún tipo.
 * El autor no se responsabiliza por el uso indebido ni por cualquier daño
 * directo o indirecto derivado de su uso.
 *
 * Para solicitar licencias comerciales o de redistribución, contacte al autor.
 * ─────────────────────────────────────────────────────────────────────────────
 */
`;

// ─── Opciones de ofuscación ───────────────────────────────────────────────────
// Se usa un nivel alto pero compatible con extensiones Chrome (no eval).
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,   // evitar en extensiones
  disableConsoleOutput: false,   // los logs [KMCERO] se mantienen
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,   // no renombrar globales del browser
  selfDefending: false,   // no compatible con CSP estricto
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.8,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'browser',
};

// ─── Proceso ──────────────────────────────────────────────────────────────────
console.log(`\n🔨 Compilando KMCERO · Ayuda para el carrito v${version}…`);

const source = fs.readFileSync(SRC, 'utf8');
// Reemplazar el placeholder de la clave secreta con el valor real
const sourceWithSecret = source.replace(
  "'MI_CLAVE_SECRETA_PRIVADA_2024'",
  JSON.stringify(secret)
);
const result = JavaScriptObfuscator.obfuscate(sourceWithSecret, OBFUSCATOR_OPTIONS);
const obfuscated = result.getObfuscatedCode();

fs.writeFileSync(DIST, LICENSE + obfuscated, 'utf8');

const srcKB = (fs.statSync(SRC).size / 1024).toFixed(1);
const distKB = (fs.statSync(DIST).size / 1024).toFixed(1);

console.log(`✅ Archivo generado: dist/content.js`);
console.log(`   Original:   ${srcKB} KB`);
console.log(`   Ofuscado:   ${distKB} KB`);
console.log(`\nListo para distribuir.\n`);
