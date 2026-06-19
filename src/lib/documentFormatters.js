export const formatDate = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = String(dateString).split('-');
  return `${day}/${month}/${year}`;
};

export const formatLongDate = (dateString, includeWeekday = false) => {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  if (includeWeekday) options.weekday = 'long';
  return new Intl.DateTimeFormat('es-PE', options).format(date);
};

export const parseBirthDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const calculateFullAgeFromBirthDate = (birthDateValue, referenceDate = new Date()) => {
  const birthDate = parseBirthDate(birthDateValue);
  if (!birthDate || birthDate > referenceDate) return '';
  let years = referenceDate.getFullYear() - birthDate.getFullYear();
  let months = referenceDate.getMonth() - birthDate.getMonth();
  let days = referenceDate.getDate() - birthDate.getDate();
  if (days < 0) {
    const previousMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0);
    days += previousMonth.getDate();
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return `${years} AÑOS ${months} MESES ${days} DÍAS`;
};

export const getAgeYears = (ageValue, birthDateValue = '') => {
  const calculated = calculateFullAgeFromBirthDate(birthDateValue);
  if (calculated) return calculated.match(/\d+/)?.[0] || '0';
  const text = String(ageValue || '');
  return text.match(/\d+/)?.[0] || '0';
};

export const formatFullAge = (ageValue, birthDateValue = '') => {
  const calculated = calculateFullAgeFromBirthDate(birthDateValue);
  if (calculated) return calculated;
  const text = String(ageValue || '').toUpperCase();
  const years = text.match(/\d+/)?.[0] || '0';
  if (text.includes('MESES') || text.includes('DÍAS') || text.includes('DIAS')) {
    const numbers = text.match(/\d+/g) || [years, '0', '0'];
    return `${numbers[0] || years} AÑOS ${numbers[1] || '0'} MESES ${numbers[2] || '0'} DÍAS`;
  }
  return `${years} AÑOS 0 MESES 0 DÍAS`;
};

export const generateAutogenerado = (dniValue) => {
  const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
  const checksum = digits.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 2), 0) % 97;
  return `${digits}${String(checksum).padStart(2, '0')}`;
};

export const generateActMed = (dniValue, dateValue) => {
  const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
  const compactDate = String(dateValue || new Date().toISOString().split('T')[0]).replace(/\D/g, '');
  const seed = `${digits}${compactDate}`;
  const checksum = seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 3), 0) % 100000;
  return `AM${compactDate.slice(2)}${String(checksum).padStart(5, '0')}`;
};

export const generateCitt = (dniValue, dateValue) => {
  const digits = String(dniValue || '').replace(/\D/g, '').padStart(8, '0');
  const compactDate = String(dateValue || new Date().toISOString().split('T')[0]).replace(/\D/g, '');
  const seed = `${digits}${compactDate}`;
  const middle = String(seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 7), 9240000000) % 9000000000 + 1000000000).slice(0, 10);
  const suffix = String(seed.split('').reduce((sum, digit, index) => sum + Number(digit) * (index + 3), 0) % 97).padStart(2, '0');
  return `T-${middle.slice(0, 3)}-${middle.slice(3)}-${suffix}`;
};

export const generateVerificationCode = (docId, randomBytesProvider) => {
  const prefixes = { descanso: 'DM', certificado: 'CM', receta: 'RX' };
  const prefix = prefixes[docId] || 'DC';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  if (randomBytesProvider) {
    bytes.set(randomBytesProvider(8));
  } else if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  }
  const random = Array.from(bytes, (byte, index) => {
    const fallback = (Date.now() + index * 37 + Math.floor(Math.random() * 255)) % alphabet.length;
    return alphabet[(byte || fallback) % alphabet.length];
  }).join('');
  return `${prefix}-${random}`;
};

export const getDiaSemana = (dateString) => {
  const date = new Date(`${dateString}T00:00:00`);
  const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  return dias[date.getDay()];
};

export const calculateEndDate = (start, days) => {
  if (!start || !days) return '';
  const date = new Date(`${start}T00:00:00`);
  date.setDate(date.getDate() + parseInt(days, 10));
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

export const getFrequencyPerDay = (frequency) => {
  const text = String(frequency || '').toUpperCase();
  const hours = Number(text.match(/CADA\s+(\d+)\s*HORA/)?.[1] || 0);
  if (hours > 0) return 24 / hours;
  if (text.includes('DOS VECES')) return 2;
  if (text.includes('TRES VECES')) return 3;
  if (text.includes('UNA VEZ') || text.includes('CADA 24')) return 1;
  if (text.includes('DOSIS ÚNICA') || text.includes('DOSIS UNICA')) return 1;
  return 0;
};

export const getTotalQuantity = (med, defaultDays = '') => {
  const dose = Number(String(med.cantidad || '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  const days = Number(String(med.duracion || defaultDays || '').replace(/\D/g, '') || 0);
  const perDay = getFrequencyPerDay(med.frecuencia);
  if (!dose || !days || !perDay) return '';
  const total = dose * days * perDay;
  return `${Number.isInteger(total) ? total : total.toFixed(2)} ${med.unidad || ''}`.trim();
};

export const generateObservationText = ({ formData, patient }) => {
  if (!formData?.cie || !patient) return '';
  if (formData.usarObsAuto) {
    const diaSemana = getDiaSemana(formData.fechaInicio);
    const fechaAtencion = formatDate(formData.fechaInicio);
    const fechaFin = calculateEndDate(formData.fechaInicio, formData.dias);
    const diagnostico = `${formData.cie.codigoCIE} - ${formData.cie.descripcionCIE.toUpperCase()}`;
    const autoText = `EL PACIENTE ${patient.nombre}, IDENTIFICADO CON DNI N.° ${patient.dni}, INGRESÓ EL DÍA ${diaSemana} ${fechaAtencion} A LAS ${formData.horaIngreso} HORAS AL ÁREA DE ${formData.servicio} DEL ${formData.establecimiento}. TRAS LA EVALUACIÓN MÉDICA POR EL PROFESIONAL ${formData.profesional}, SE DETERMINÓ COMO DIAGNÓSTICO PRINCIPAL: ${diagnostico}. SE INDICA DESCANSO MÉDICO POR ${formData.dias} DÍA(S), DESDE EL ${fechaAtencion} HASTA EL ${fechaFin}. EL PACIENTE DEBERÁ MANTENER ADECUADA HIDRATACIÓN, GUARDAR REPOSO, CUMPLIR LAS INDICACIONES MÉDICAS BRINDADAS Y ACUDIR A CONTROL SEGÚN EVOLUCIÓN.`;
    return formData.obsCustom.trim() ? `${autoText}\n\nNOTAS ADICIONALES: ${formData.obsCustom.toUpperCase()}` : autoText;
  }
  return formData.obsCustom.toUpperCase();
};
