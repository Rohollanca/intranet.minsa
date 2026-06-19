import { generateDocumentDocx } from './documentGenerator.js';
import { buildDocumentPayload } from './documentPayload.js';
import { getTemplateCandidates } from './documentTemplates.js';

export const createOfficialDocument = async ({
  patient,
  formData,
  selectedDoc,
  institucion,
  verificationBaseUrl,
  loadTemplate,
  output = 'blob',
  verificationCode,
} = {}) => {
  const candidates = getTemplateCandidates({ documentId: selectedDoc?.id, institucion });

  let selectedTemplate = null;
  let templateBuffer = null;
  for (const path of candidates) {
    const loaded = await loadTemplate(path);
    if (!loaded) continue;
    const bytes = new Uint8Array(loaded.buffer.slice(0, 4));
    const isDocxZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isDocxZip) {
      selectedTemplate = loaded.path || path;
      templateBuffer = loaded.buffer;
      break;
    }
  }

  if (!templateBuffer) {
    throw new Error(`Plantilla oficial no encontrada: ${candidates.join(', ')}`);
  }

  const payload = buildDocumentPayload({
    patient,
    formData,
    selectedDoc,
    institucion,
    verificationBaseUrl,
    verificationCode,
  });

  const docx = await generateDocumentDocx({
    templateBuffer,
    templateData: payload.templateData,
    verificationUrl: payload.generated.verificationUrl,
    output,
  });

  return {
    docx,
    templatePath: selectedTemplate,
    ...payload,
  };
};
