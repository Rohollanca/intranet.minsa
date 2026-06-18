import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const EXCEL_PATH = path.join(process.cwd(), 'CIE10_MINSA_OFICIAL.xlsx');
const OUT_DIR = path.join(process.cwd(), 'src', 'data');
const OUT_PATH = path.join(OUT_DIR, 'cie10-peru.json');

if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌ Archivo no encontrado: ${EXCEL_PATH}`);
    process.exit(1);
}

console.log('⏳ Leyendo archivo Excel...');
const workbook = xlsx.readFile(EXCEL_PATH);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
const cie10Data = [];

// A code is typically a letter followed by 2-4 digits.
const codeRegex = /^[A-Z]\d{2,4}$/i;

console.log('🔍 Extrayendo códigos...');

data.forEach(row => {
    if (!row || row.length === 0) return;
    
    // The text is in the first column
    const text = String(row[0]).trim();
    
    // Look for lines containing ' - '
    const parts = text.split(' - ');
    if (parts.length >= 2) {
        const codigo = parts[0].trim().toUpperCase();
        // The description is everything after the first ' - '
        const descripcion = parts.slice(1).join(' - ').trim();
        
        // Ensure the code part looks like a CIE10 code and not a category like (A00
        if (codeRegex.test(codigo)) {
             cie10Data.push({ codigo, descripcion });
        }
    }
});

const uniqueData = Array.from(new Map(cie10Data.map(item => [item.codigo, item])).values());

if (!fs.existsSync(OUT_DIR)){
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

fs.writeFileSync(OUT_PATH, JSON.stringify(uniqueData, null, 2), 'utf-8');

console.log(`✅ Procesamiento completado. Se generaron ${uniqueData.length} registros CIE-10 únicos en src/data/cie10-peru.json`);
