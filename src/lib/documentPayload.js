import {
  calculateEndDate,
  formatDate,
  formatFullAge,
  formatLongDate,
  generateActMed,
  generateAutogenerado,
  generateCitt,
  generateObservationText,
  generateVerificationCode,
  getAgeYears,
  getTotalQuantity,
} from './documentFormatters.js';

export const buildDocumentPayload = ({
  patient,
  formData,
  selectedDoc,
  institucion,
  verificationBaseUrl,
  verificationCode,
} = {}) => {
  const tipoSeguroInstitucional = institucion === 'ESSALUD' ? 'ESSALUD' : 'SIS';
  const numeroOrden = formData.numeroOrden || String(Math.floor(88000000 + Math.random() * 999999));
  const noCitt = formData.numeroOrden || generateCitt(patient.dni, formData.fechaInicio);
  const pi = formData.pi || patient.pi || `${patient.dni}${String(Date.now()).slice(-2)}`;
  const fechaFin = calculateEndDate(formData.fechaInicio, formData.dias);
  const autogenerado = patient.autogenerado || generateAutogenerado(patient.dni);
  const actMed = patient.actMed || generateActMed(patient.dni, formData.fechaInicio);
  const codigoVerificacion = verificationCode || generateVerificationCode(selectedDoc?.id);
  const verificationUrl = `${verificationBaseUrl}/verificar?codigo=${encodeURIComponent(codigoVerificacion)}`;

  const templateData = {
    ESTABLECIMIENTO: formData.establecimiento, SERVICIO: formData.servicio, PROFESIONAL: formData.profesional, CMP: formData.cmp,
    PACIENTE: patient.nombre, DNI: patient.dni, EDAD: selectedDoc?.id === 'certificado' ? getAgeYears(patient.edad, patient.fechaNacimiento) : formatFullAge(patient.edad, patient.fechaNacimiento), SEXO: patient.sexo, HC: patient.hc,
    NUMERO_ORDEN: numeroOrden, INSTITUCION: institucion, FARMACIA: formData.farmacia, PI: pi,
    AUTOGENERADO: autogenerado, ACT_MED: actMed,
    NO_CITT: noCitt, ACTO_MEDICO: actMed, TIPO_ATENCION: formData.tipoAtencion.toUpperCase(),
    VIGENCIA: formatDate(formData.vigencia), DIAS: formData.dias, DIAS_TEXTO: `${formData.dias} DÍAS`,
    DIAS_CONSECUTIVOS: formData.dias, DIAS_NO_CONSECUTIVOS: formData.diasNoConsecutivos || '0',
    FECHA_OTORGAMIENTO: formatDate(formData.fechaInicio),
    FECHA: formatDate(formData.fechaInicio), HORA: formData.horaIngreso, FECHA_FIN: fechaFin,
    FECHA_INICIO: formatDate(formData.fechaInicio), INICIO_DESCANSO: formatDate(formData.fechaInicio),
    FECHA_ATENCION_LARGA: formatLongDate(formData.fechaInicio), HORA_ATENCION: formData.horaIngreso,
    FECHA_EMISION_LARGA: formatLongDate(formData.fechaInicio, true), DISTRITO: formData.distrito.toUpperCase(),
    SEGURO: tipoSeguroInstitucional, TIPO_SEGURO: tipoSeguroInstitucional, CIE10_CODIGO: formData.cie?.codigoCIE || '',
    CIE10_DESCRIPCION: formData.cie?.descripcionCIE?.toUpperCase() || '', OBSERVACIONES: generateObservationText({ formData, patient }),
    DIAGNOSTICO: formData.cie?.descripcionCIE?.toUpperCase() || '',
    MEDICO: formData.profesional, CMP_MEDICO: formData.cmp,
    CODIGO_VERIFICACION: codigoVerificacion, URL_VERIFICACION: verificationUrl,
    MEDS: formData.meds.map((m, i) => ({
      idx: i + 1,
      codigo: String(211683 + i),
      n: (m.nombre || 'MEDICAMENTO').toUpperCase(),
      d: (m.concentracion || `${m.cantidad || ''} ${m.unidad || ''}`).trim().toUpperCase(),
      via: (m.via || '').toUpperCase(),
      f: (m.frecuencia || '').toUpperCase(),
      indicacion: (m.indicacion || '').toUpperCase(),
      cantidad: m.cantidad || '',
      unidad: (m.unidad || '').toUpperCase(),
      presentacion: (m.presentacion || '').toUpperCase(),
      cantidad_total: getTotalQuantity(m, formData.dias).toUpperCase(),
      CANTIDAD_TOTAL: getTotalQuantity(m, formData.dias).toUpperCase(),
      dias: (m.duracion || formData.dias || '').toString().replace(/\D/g, '') || String(formData.dias || ''),
      duracion: (m.duracion || formData.dias || '').toString().replace(/\D/g, '') || String(formData.dias || '')
    }))
  };

  const verificationRecord = {
    codigo: codigoVerificacion,
    url: verificationUrl,
    estado: 'VALIDO',
    documento: selectedDoc?.label || selectedDoc?.id || 'Documento de salud',
    documentoId: selectedDoc?.id || 'documento',
    institucion,
    establecimiento: formData.establecimiento,
    paciente: patient.nombre,
    dni: patient.dni,
    fecha: formatDate(formData.fechaInicio),
    fechaIso: formData.fechaInicio,
    medico: formData.profesional,
    cmp: formData.cmp,
    diagnostico: formData.cie?.descripcionCIE?.toUpperCase() || '',
    cie10: formData.cie?.codigoCIE || '',
    numeroOrden,
    noCitt,
    autogenerado,
    actMed
  };

  return {
    templateData,
    verificationRecord,
    generated: { codigoVerificacion, verificationUrl, numeroOrden, noCitt, autogenerado, actMed },
  };
};
