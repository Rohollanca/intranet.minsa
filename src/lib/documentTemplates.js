export const getTemplateCandidates = ({ documentId = 'descanso', institucion = 'MINSA' } = {}) => {
  const inst = institucion === 'ESSALUD' ? 'ESSALUD' : 'MINSA';
  const templates = {
    descanso: [
      `/DESCANSO_MEDICO_${inst}.docx`,
      `/DESCANSO MEDICO_${inst}.docx`,
      `/DESCANSO-MEDICO-${inst}.docx`,
      '/CONSTANCIA-MINSA-73022866_backup.docx',
    ],
    certificado: [
      `/CERTIFICADO MEDICO_${inst}.docx`,
      `/CERTIFICADO_MEDICO_${inst}.docx`,
      `/CERTIFICADO-MEDICO-${inst}.docx`,
      '/CERTIFICADO-MEDICO-ESSALUD-72730202.docx',
    ],
    receta: [
      `/RECETA-MEDICA-${inst}.docx`,
      '/RECETA-MEDICA-MINSA-44443333.docx',
    ],
  };

  return templates[documentId] || templates.descanso;
};
