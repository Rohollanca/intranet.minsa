import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import QRCode from 'qrcode';
import ImageModule from 'docxtemplater-image-module-free/js/index.js';
import { createOfficialDocument } from '../src/lib/documentService.js';
import { buildDocumentPayload } from '../src/lib/documentPayload.js';

const root = process.cwd();
const verificationBaseUrl = 'https://portalwebminsa-certificados.onrender.com';

const fixture = {
  patient: {
    nombre: 'MARIA OLINDA SANCHEZ GONZALES',
    dni: '75481714',
    edad: '20',
    fechaNacimiento: '18/06/2006',
    sexo: 'FEMENINO',
    hc: 'HC-75481714',
    autogenerado: '7548171487',
    actMed: 'AM26061600574',
    pi: '7793596341',
  },
  formData: {
    establecimiento: 'HOSPITAL LA CALETA',
    servicio: 'EMERGENCIA',
    profesional: 'RUZ VIVAS, NILIBETH LORIANNY',
    cmp: '090558',
    cie: { codigoCIE: 'A099', descripcionCIE: 'GASTROENTERITIS Y COLITIS DE ORIGEN NO ESPECIFICADO' },
    dias: 3,
    fechaInicio: '2026-06-16',
    horaIngreso: '15:28',
    obsCustom: '',
    usarObsAuto: true,
    farmacia: 'FARMACIA CENTRAL',
    pi: '7793596341',
    distrito: 'LIMA',
    tipoAtencion: 'EMERGENCIA/URGENCIAS',
    diasNoConsecutivos: '0',
    vigencia: '2026-06-16',
    numeroOrden: 'T-124-0000814-89',
    meds: [{ nombre: 'AMOXICILINA', concentracion: '400 MG', presentacion: 'TABLETA', cantidad: '400', unidad: 'MG', via: 'ORAL', frecuencia: 'CADA 8 HORAS', duracion: '5', indicacion: '' }],
  },
  selectedDoc: { id: 'descanso', label: 'Descanso Médico' },
  institucion: 'MINSA',
  verificationCode: 'DM-TEST1234',
};

const dataUrlToArrayBuffer = (dataUrl) => {
  const base64 = String(dataUrl).split(',')[1] || '';
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

const legacyGenerate = async ({ templateBuffer, templateData, verificationUrl }) => {
  const zip = new PizZip(templateBuffer);
  zip.file(/word\/.*\.xml$/).forEach((file) => {
    const xml = file.asText();
    const normalizedXml = xml
      .replace(/\{\{\s*QR_IMAGE\s*\}\}/g, '{{%QR_IMAGE}}')
      .replace(/\{\{\s*QR\s*\}\}/g, '{{%QR_IMAGE}}');
    if (normalizedXml !== xml) zip.file(file.name, normalizedXml);
  });
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'L',
    margin: 1,
    scale: 8,
  });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    modules: [new ImageModule({
      centered: false,
      getImage: (tag) => dataUrlToArrayBuffer(tag),
      getSize: () => [105, 105],
    })]
  });
  doc.render({ ...templateData, QR_IMAGE: qrDataUrl });
  return doc.getZip().generate({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
};

const zipEntries = (buffer) => {
  const zip = new PizZip(buffer);
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort()
    .map((name) => [name, zip.files[name].asBinary()]);
};

const assertSameDocx = (left, right) => {
  const leftEntries = zipEntries(left);
  const rightEntries = zipEntries(right);
  const leftNames = leftEntries.map(([name]) => name).join('\n');
  const rightNames = rightEntries.map(([name]) => name).join('\n');
  if (leftNames !== rightNames) {
    throw new Error('Las entradas internas del DOCX no coinciden.');
  }
  for (let i = 0; i < leftEntries.length; i += 1) {
    const [name, leftContent] = leftEntries[i];
    const [, rightContent] = rightEntries[i];
    if (leftContent !== rightContent) {
      throw new Error(`Contenido diferente en ${name}`);
    }
  }
};

const templatePath = join(root, 'public', 'DESCANSO MEDICO_MINSA.docx');
const templateBuffer = readFileSync(templatePath);
const arrayBuffer = templateBuffer.buffer.slice(templateBuffer.byteOffset, templateBuffer.byteOffset + templateBuffer.byteLength);

const payload = buildDocumentPayload({
  patient: fixture.patient,
  formData: fixture.formData,
  selectedDoc: fixture.selectedDoc,
  institucion: fixture.institucion,
  verificationBaseUrl,
  verificationCode: fixture.verificationCode,
});

const legacy = await legacyGenerate({
  templateBuffer: arrayBuffer,
  templateData: payload.templateData,
  verificationUrl: payload.generated.verificationUrl,
});

const next = await createOfficialDocument({
  patient: fixture.patient,
  formData: fixture.formData,
  selectedDoc: fixture.selectedDoc,
  institucion: fixture.institucion,
  verificationBaseUrl,
  verificationCode: fixture.verificationCode,
  output: 'nodebuffer',
  loadTemplate: async () => ({ path: templatePath, buffer: arrayBuffer }),
});

assertSameDocx(legacy, next.docx);
console.log('OK: documentService genera DOCX identico a la logica anterior.');
