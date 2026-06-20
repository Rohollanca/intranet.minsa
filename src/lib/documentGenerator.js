import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import QRCode from 'qrcode';
import ImageModule from 'docxtemplater-image-module-free/js/index.js';

const dataUrlToArrayBuffer = (dataUrl) => {
  const base64 = String(dataUrl).split(',')[1] || '';
  if (typeof window !== 'undefined' && window.atob) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
  }
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export const generateDocumentDocx = async ({
  templateBuffer,
  templateData,
  verificationUrl,
  output = 'blob',
} = {}) => {
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
    type: output === 'nodebuffer' ? 'nodebuffer' : 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
};
