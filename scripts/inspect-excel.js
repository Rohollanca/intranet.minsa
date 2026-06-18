import xlsx from 'xlsx';
import path from 'path';

const EXCEL_PATH = path.join(process.cwd(), 'CIE10_MINSA_OFICIAL.xlsx');
const workbook = xlsx.readFile(EXCEL_PATH);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log('--- Primeras 10 filas del Excel ---');
for (let i = 0; i < Math.min(10, data.length); i++) {
    console.log(`Fila ${i + 1}:`, data[i]);
}
